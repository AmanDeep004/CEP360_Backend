/**
 * Streaming Excel processor for large files (10L - 15L+ records).
 * Uses exceljs WorkbookReader for true row-by-row streaming — no full file load into RAM.
 * Processes records in chunks of 5000, with batched duplicate checks (max 1000 per $in).
 * Returns a jobId immediately; processing happens in background.
 */

import fs from "fs";
import Company from "../models/MasterDBModel/companyModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";

// In-memory job store — survives the request but resets on server restart
export const jobStore = new Map();

const safeStr = (v) => (v == null || v === "" ? "" : String(v).trim());

const parseDateVal = (v) => {
  if (!v) return null;
  const s = safeStr(v).toLowerCase();
  if (["blank", "null", "", "na"].includes(s)) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Processes a single chunk of rows (up to 5000):
 *  1. Bulk upsert companies (chunks of 500)
 *  2. Fetch company IDs
 *  3. Duplicate phone/email check (chunks of 1000 per $in)
 *  4. Bulk upsert contacts (chunks of 2000)
 */
async function processChunk(rows, batchName, lastNumber, job) {
  // --- Companies ---
  const uniqueCompanies = new Set();
  const companyRowMap = new Map();
  for (const r of rows) {
    const cn = safeStr(r.Company_Name);
    if (cn) {
      uniqueCompanies.add(cn);
      if (!companyRowMap.has(cn)) companyRowMap.set(cn, r);
    }
  }

  const companyOps = [];
  for (const cn of uniqueCompanies) {
    const cr = companyRowMap.get(cn);
    companyOps.push({
      updateOne: {
        filter: { Company_Name: cn },
        update: {
          $set: {
            Company_ID_Kestone: cr.Company_ID_Kestone || "",
            Affinity_ID_Dell: cr.Affinity_ID_Dell || "",
            Company_ID_Google: cr.Company_ID_Google || "",
            Company_Source: cr.Company_Source || "",
            Company_Name: cn,
            Year_Founded: cr.Year_Founded || "",
            Turnover_Range: cr.Turnover_Range || "",
            Employees_Range: cr.Employees_Range || "",
            Industry: cr.Industry || "",
            Sub_Industry: cr.Sub_Industry || "",
            Company_Segment: cr.Company_Segment || "",
            Website: cr.Website || "",
            Company_LinkedIn_Profile: cr.Company_LinkedIn_Profile || "",
            Company_Phone1: cr.Company_Phone1 || "",
            Company_Phone2: cr.Company_Phone2 || "",
          },
        },
        upsert: true,
      },
    });
  }

  for (let i = 0; i < companyOps.length; i += 500) {
    const result = await Company.bulkWrite(companyOps.slice(i, i + 500), {
      ordered: false,
      writeConcern: { w: 1 },
    });
    job.progress.companiesCreated += result.upsertedCount;
  }

  // Fetch company _id map for this chunk
  const companyDocs = await Company.find(
    { Company_Name: { $in: [...uniqueCompanies] } },
    { Company_Name: 1 }
  ).lean();
  const companyMap = new Map(companyDocs.map((c) => [c.Company_Name, c._id]));

  // --- Duplicate check (batched $in, max 1000 per query) ---
  const phonesToCheck = new Set();
  const emailsToCheck = new Set();
  for (const r of rows) {
    const p1 = safeStr(r.Contact_Direct_Phone1);
    const p2 = safeStr(r.Contact_Direct_Phone2);
    const e1 = safeStr(r.Personal_Email1);
    const e2 = safeStr(r.Personal_Email2);
    if (p1) phonesToCheck.add(p1);
    if (p2) phonesToCheck.add(p2);
    if (e1) emailsToCheck.add(e1.toLowerCase());
    if (e2) emailsToCheck.add(e2.toLowerCase());
  }

  const DUP_BATCH = 1000;
  const duplicatePhones = new Set();
  const duplicateEmails = new Set();

  const phonesArr = [...phonesToCheck];
  for (let i = 0; i < phonesArr.length; i += DUP_BATCH) {
    const batch = phonesArr.slice(i, i + DUP_BATCH);
    const found = await Contact.find(
      {
        $or: [
          { Contact_Direct_Phone1: { $in: batch } },
          { Contact_Direct_Phone2: { $in: batch } },
        ],
      },
      { Contact_Direct_Phone1: 1, Contact_Direct_Phone2: 1 }
    ).lean();
    for (const c of found) {
      if (c.Contact_Direct_Phone1) duplicatePhones.add(c.Contact_Direct_Phone1);
      if (c.Contact_Direct_Phone2) duplicatePhones.add(c.Contact_Direct_Phone2);
    }
  }

  const emailsArr = [...emailsToCheck];
  for (let i = 0; i < emailsArr.length; i += DUP_BATCH) {
    const batch = emailsArr.slice(i, i + DUP_BATCH);
    const found = await Contact.find(
      {
        $or: [
          { Personal_Email1: { $in: batch } },
          { Personal_Email2: { $in: batch } },
        ],
      },
      { Personal_Email1: 1, Personal_Email2: 1 }
    ).lean();
    for (const c of found) {
      if (c.Personal_Email1) duplicateEmails.add(c.Personal_Email1.toLowerCase());
      if (c.Personal_Email2) duplicateEmails.add(c.Personal_Email2.toLowerCase());
    }
  }

  // --- Build contact bulkWrite ops ---
  const contactOps = [];
  for (const r of rows) {
    if (!r.Company_Name) {
      job.progress.skipped++;
      continue;
    }

    // Auto-generate Contact_ID if missing
    if (!r.Contact_ID || safeStr(r.Contact_ID) === "") {
      lastNumber++;
      r.Contact_ID = `CEP-A-${String(lastNumber).padStart(6, "0")}`;
    }

    const companyId = companyMap.get(safeStr(r.Company_Name));
    if (!companyId) {
      job.progress.skipped++;
      continue;
    }

    const p1 = safeStr(r.Contact_Direct_Phone1);
    const p2 = safeStr(r.Contact_Direct_Phone2);
    const e1 = safeStr(r.Personal_Email1);
    const e2 = safeStr(r.Personal_Email2);

    if (
      (p1 && duplicatePhones.has(p1)) ||
      (p2 && duplicatePhones.has(p2)) ||
      (e1 && duplicateEmails.has(e1.toLowerCase())) ||
      (e2 && duplicateEmails.has(e2.toLowerCase()))
    ) {
      job.progress.skipped++;
      continue;
    }

    contactOps.push({
      updateOne: {
        filter: { Contact_ID: r.Contact_ID },
        update: {
          $set: {
            Contact_ID: safeStr(r.Contact_ID),
            Contact_Source: safeStr(r.Contact_Source),
            Contact_Create_Date: parseDateVal(r.Contact_Create_Date),
            Salutation: safeStr(r.Salutation),
            First_Name: safeStr(r.First_Name),
            Last_Name: safeStr(r.Last_Name),
            Full_Name: safeStr(r.Full_Name),
            Gender: safeStr(r.Gender),
            Job_Title: safeStr(r.Job_Title),
            Job_Seniority: safeStr(r.Job_Seniority),
            Job_Function: safeStr(r.Job_Function),
            Contact_Address_1: safeStr(r.Contact_Address_1),
            Contact_Address_2: safeStr(r.Contact_Address_2),
            Contact_Address_3: safeStr(r.Contact_Address_3),
            Contact_City: safeStr(r.Contact_City),
            Contact_Pin: safeStr(r.Contact_Pin),
            Contact_State: safeStr(r.Contact_State),
            Contact_Region: safeStr(r.Contact_Region),
            Contact_Country: safeStr(r.Contact_Country),
            Contact_STD_ISD_Code: safeStr(r.Contact_STD_ISD_Code),
            Contact_Location_Tier: safeStr(r.Contact_Location_Tier),
            Contact_Direct_Phone1: p1,
            Contact_Direct_Phone2: p2,
            Contact_Extn_No: safeStr(r.Contact_Extn_No),
            Mobile_No: safeStr(r.Mobile_No),
            Office_Email_1: safeStr(r.Office_Email_1).toLowerCase(),
            Office_Email_2: safeStr(r.Office_Email_2).toLowerCase(),
            Personal_Email1: e1,
            Personal_Email2: e2,
            Contact_LinkedIn_Profile: safeStr(r.Contact_LinkedIn_Profile),
            Unsubscribe_Flag: safeStr(r["Unsubscribe Flag (Yes/No)"]),
            Unsubscribe_Account_Tag: safeStr(r.Unsubscribe_Account_Tag),
            DND_Flag: safeStr(r["DND Flag (Yes/No)"]),
            DND_Account_Tag: safeStr(r.DND_Account_Tag),
            Last_Engagement: safeStr(r.Last_Engagement),
            Last_Engagement_Date: parseDateVal(r.Last_Engagement_Date),
            Last_Engagement_Campaign: safeStr(r.Last_Engagement_Campaign),
            Telecalling_Remarks: safeStr(r.Telecalling_Remarks),
            BatchName: batchName,
            Company_ID: companyId,
          },
        },
        upsert: true,
      },
    });
  }

  // Write contacts in sub-chunks of 2000
  for (let i = 0; i < contactOps.length; i += 2000) {
    const result = await Contact.bulkWrite(contactOps.slice(i, i + 2000), {
      ordered: false,
      writeConcern: { w: 1 },
    });
    job.progress.contactsCreated += result.upsertedCount;
    job.progress.processed += contactOps.slice(i, i + 2000).length;
  }

  return lastNumber;
}

/**
 * Main background processor.
 * Streams Excel file row-by-row via exceljs, flushes every 5000 rows.
 */
export async function processExcelInBackground(jobId, filePath, batchName) {
  const job = jobStore.get(jobId);
  try {
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      formulae: "ignore",
    });

    // Get current max Contact_ID number once before streaming
    const lastContact = await Contact.findOne({}, { Contact_ID: 1 })
      .sort({ _id: -1 })
      .lean();
    let lastNumber = 0;
    if (lastContact?.Contact_ID) {
      const m = lastContact.Contact_ID.match(/CEP-A-(\d+)/);
      if (m) lastNumber = parseInt(m[1]);
    }

    let headers = null;
    let rowBuffer = [];
    const CHUNK_SIZE = 5000;

    for await (const worksheetReader of workbook) {
      for await (const row of worksheetReader) {
        // Row 1 = header row
        if (row.number === 1) {
          headers = {};
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = cell.value;
          });
          continue;
        }
        if (!headers) continue;

        // Map cell values to header names
        const rowObj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber];
          if (header) rowObj[header] = cell.value ?? "";
        });

        rowBuffer.push(rowObj);
        job.progress.totalRows++;

        if (rowBuffer.length >= CHUNK_SIZE) {
          lastNumber = await processChunk(rowBuffer, batchName, lastNumber, job);
          rowBuffer = [];
          console.log(`[Job ${jobId}] Processed ${job.progress.totalRows} rows so far...`);
        }
      }
      break; // Only first sheet
    }

    // Flush remaining rows
    if (rowBuffer.length > 0) {
      await processChunk(rowBuffer, batchName, lastNumber, job);
    }

    fs.unlink(filePath, () => {});
    job.status = "completed";
    job.completedAt = new Date();
    console.log(`[Job ${jobId}] Completed. Total rows: ${job.progress.totalRows}`);
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    job.completedAt = new Date();
    console.error(`[Job ${jobId}] Failed:`, err);
    fs.unlink(filePath, () => {});
  }
}
