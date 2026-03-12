/**
 * Streaming Excel processor for large files (10L - 15L+ records).
 * Uses exceljs WorkbookReader for true row-by-row streaming — no full file load into RAM.
 * Processes records in chunks of 5000, with batched duplicate checks (max 1000 per $in).
 * Returns a jobId immediately; processing happens in background.
 *
 * Logic per row:
 *  1. Check contact duplicacy FIRST (email / mobile against DB + same chunk)
 *  2. If duplicate  → skip row entirely (company is NOT touched)
 *  3. If not duplicate → check company in DB
 *  4. Company exists  → reuse its _id
 *  5. Company missing → create new company entry
 *  6. Insert contact with company _id
 */

import fs from "fs";
import Company from "../models/MasterDBModel/companyModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";

// In-memory job store — survives the request but resets on server restart
export const jobStore = new Map();

const safeStr = (v) => (v == null || v === "" ? "" : String(v).trim());

// Literal placeholder strings that appear as cell values in Excel exports
const BLANK_LIKE = new Set([
  "", "null", "na", "n/a", "n.a", "n.a.", "none", "blank",
  "nil", "0", "00", "000", "-", "--", "---", "undefined",
  "not available", "not applicable", "#n/a", "#na", "unknown",
  "no data", "no email", "no phone", "nill", "blk",
]);

/**
 * isValidPhone — true only if value has at least 7 digits.
 * Rejects blanks, placeholder strings, and too-short/non-numeric values.
 */
const isValidPhone = (val) => {
  if (!val) return false;
  const s = String(val).trim();
  if (BLANK_LIKE.has(s.toLowerCase())) return false;
  const digits = s.replace(/\D/g, "");   // strip non-digits
  return digits.length >= 7;             // real phone must have 7+ digits
};

/**
 * isValidEmail — true only if value contains "@" and a "." after "@".
 * Rejects blanks, placeholder strings, and obviously malformed values.
 */
const isValidEmail = (val) => {
  if (!val) return false;
  const s = String(val).trim();
  if (BLANK_LIKE.has(s.toLowerCase())) return false;
  const atIdx = s.indexOf("@");
  if (atIdx < 1) return false;           // no "@" or starts with "@"
  const afterAt = s.slice(atIdx + 1);
  return afterAt.includes(".");          // domain must have a "."
};

const parseDateVal = (v) => {
  if (!v) return null;
  const s = safeStr(v).toLowerCase();
  if (["blank", "null", "", "na"].includes(s)) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Processes a single chunk of rows (up to 5000).
 *
 * Step 1 — Contact duplicate check (DB + intra-chunk)
 *   Phones : Contact_Direct_Phone1, Contact_Direct_Phone2, Mobile_No
 *   Emails : Personal_Email1, Personal_Email2, Office_Email_1, Office_Email_2
 *
 * Step 2 — Filter valid (non-duplicate, has Company_Name) rows
 *
 * Step 3 — Company resolution for valid rows only
 *   - Find existing companies in DB → reuse _id
 *   - Create missing companies → get new _id
 *
 * Step 4 — Insert contacts with resolved company _id
 */
async function processChunk(rows, batchName, lastNumber, job) {
  const DUP_BATCH = 1000;

  // ── Step 1: Collect phones & emails from all rows for DB duplicate check ──
  const phonesToCheck = new Set();
  const emailsToCheck = new Set();

  for (const r of rows) {
    const p1  = safeStr(r.Contact_Direct_Phone1);
    const p2  = safeStr(r.Contact_Direct_Phone2);
    const mob = safeStr(r.Mobile_No);
    const e1  = safeStr(r.Personal_Email1).toLowerCase();
    const e2  = safeStr(r.Personal_Email2).toLowerCase();
    const oe1 = safeStr(r.Office_Email_1).toLowerCase();
    const oe2 = safeStr(r.Office_Email_2).toLowerCase();

    // Only add real phone numbers / real emails — skip blank/placeholder values
    if (isValidPhone(p1))  phonesToCheck.add(p1);
    if (isValidPhone(p2))  phonesToCheck.add(p2);
    if (isValidPhone(mob)) phonesToCheck.add(mob);
    if (isValidEmail(e1))  emailsToCheck.add(e1);
    if (isValidEmail(e2))  emailsToCheck.add(e2);
    if (isValidEmail(oe1)) emailsToCheck.add(oe1);
    if (isValidEmail(oe2)) emailsToCheck.add(oe2);
  }

  // DB duplicate check — phones (Contact_Direct_Phone1, Contact_Direct_Phone2, Mobile_No)
  const duplicatePhones = new Set();
  const phonesArr = [...phonesToCheck];
  for (let i = 0; i < phonesArr.length; i += DUP_BATCH) {
    const batch = phonesArr.slice(i, i + DUP_BATCH);
    const found = await Contact.find(
      {
        $or: [
          { Contact_Direct_Phone1: { $in: batch } },
          { Contact_Direct_Phone2: { $in: batch } },
          { Mobile_No: { $in: batch } },
        ],
      },
      { Contact_Direct_Phone1: 1, Contact_Direct_Phone2: 1, Mobile_No: 1 }
    ).lean();
    for (const c of found) {
      // Guard DB values too — stored blanks must not become false duplicate keys
      if (isValidPhone(c.Contact_Direct_Phone1)) duplicatePhones.add(c.Contact_Direct_Phone1);
      if (isValidPhone(c.Contact_Direct_Phone2)) duplicatePhones.add(c.Contact_Direct_Phone2);
      if (isValidPhone(c.Mobile_No))             duplicatePhones.add(c.Mobile_No);
    }
  }

  // DB duplicate check — emails (all 4 email fields)
  const duplicateEmails = new Set();
  const emailsArr = [...emailsToCheck];
  for (let i = 0; i < emailsArr.length; i += DUP_BATCH) {
    const batch = emailsArr.slice(i, i + DUP_BATCH);
    const found = await Contact.find(
      {
        $or: [
          { Personal_Email1: { $in: batch } },
          { Personal_Email2: { $in: batch } },
          { Office_Email_1: { $in: batch } },
          { Office_Email_2: { $in: batch } },
        ],
      },
      { Personal_Email1: 1, Personal_Email2: 1, Office_Email_1: 1, Office_Email_2: 1 }
    ).lean();
    for (const c of found) {
      if (isValidEmail(c.Personal_Email1)) duplicateEmails.add(c.Personal_Email1.toLowerCase());
      if (isValidEmail(c.Personal_Email2)) duplicateEmails.add(c.Personal_Email2.toLowerCase());
      if (isValidEmail(c.Office_Email_1))  duplicateEmails.add(c.Office_Email_1.toLowerCase());
      if (isValidEmail(c.Office_Email_2))  duplicateEmails.add(c.Office_Email_2.toLowerCase());
    }
  }

  // ── Step 2: Filter valid rows ──
  // Duplicate rows  → skip (company not touched)
  // Missing company → fail
  const seenPhonesInChunk = new Set();
  const seenEmailsInChunk = new Set();
  const validRows = [];

  for (const r of rows) {
    const companyName = safeStr(r.Company_Name);

    // Fail: no company name
    if (!companyName) {
      job.progress.failed++;
      job.progress.failReasons.missingCompanyName++;
      continue;
    }

    const p1  = safeStr(r.Contact_Direct_Phone1);
    const p2  = safeStr(r.Contact_Direct_Phone2);
    const mob = safeStr(r.Mobile_No);
    const e1  = safeStr(r.Personal_Email1).toLowerCase();
    const e2  = safeStr(r.Personal_Email2).toLowerCase();
    const oe1 = safeStr(r.Office_Email_1).toLowerCase();
    const oe2 = safeStr(r.Office_Email_2).toLowerCase();

    // Duplicate: matches an existing DB contact (only checked for real values)
    const isDbDuplicate =
      (isValidPhone(p1)  && duplicatePhones.has(p1))  ||
      (isValidPhone(p2)  && duplicatePhones.has(p2))  ||
      (isValidPhone(mob) && duplicatePhones.has(mob)) ||
      (isValidEmail(e1)  && duplicateEmails.has(e1))  ||
      (isValidEmail(e2)  && duplicateEmails.has(e2))  ||
      (isValidEmail(oe1) && duplicateEmails.has(oe1)) ||
      (isValidEmail(oe2) && duplicateEmails.has(oe2));

    // Duplicate: matches another row in the same chunk (only checked for real values)
    const isChunkDuplicate =
      (isValidPhone(p1)  && seenPhonesInChunk.has(p1))  ||
      (isValidPhone(p2)  && seenPhonesInChunk.has(p2))  ||
      (isValidPhone(mob) && seenPhonesInChunk.has(mob)) ||
      (isValidEmail(e1)  && seenEmailsInChunk.has(e1))  ||
      (isValidEmail(e2)  && seenEmailsInChunk.has(e2))  ||
      (isValidEmail(oe1) && seenEmailsInChunk.has(oe1)) ||
      (isValidEmail(oe2) && seenEmailsInChunk.has(oe2));

    if (isDbDuplicate || isChunkDuplicate) {
      job.progress.duplicates++;
      continue; // company is NOT touched
    }

    // Mark only real phones/emails as seen in this chunk
    if (isValidPhone(p1))  seenPhonesInChunk.add(p1);
    if (isValidPhone(p2))  seenPhonesInChunk.add(p2);
    if (isValidPhone(mob)) seenPhonesInChunk.add(mob);
    if (isValidEmail(e1))  seenEmailsInChunk.add(e1);
    if (isValidEmail(e2))  seenEmailsInChunk.add(e2);
    if (isValidEmail(oe1)) seenEmailsInChunk.add(oe1);
    if (isValidEmail(oe2)) seenEmailsInChunk.add(oe2);

    validRows.push(r);
  }

  if (validRows.length === 0) return lastNumber;

  // ── Step 3: Company resolution — only for valid (non-duplicate) rows ──

  // Collect unique company names from valid rows only
  const uniqueCompanies = new Set();
  const companyRowMap   = new Map(); // first occurrence of each company row
  for (const r of validRows) {
    const cn = safeStr(r.Company_Name);
    uniqueCompanies.add(cn);
    if (!companyRowMap.has(cn)) companyRowMap.set(cn, r);
  }

  // Find which companies already exist in DB
  const existingDocs = await Company.find(
    { Company_Name: { $in: [...uniqueCompanies] } },
    { Company_Name: 1 }
  ).lean();
  const companyMap = new Map(existingDocs.map((c) => [c.Company_Name, c._id]));

  // Create only the companies that are NOT in DB yet
  const newCompanyOps = [];
  for (const cn of uniqueCompanies) {
    if (companyMap.has(cn)) continue; // already exists → reuse its _id
    const cr = companyRowMap.get(cn);
    newCompanyOps.push({
      updateOne: {
        filter: { Company_Name: cn },
        update: {
          $set: {
            Company_ID_Kestone:      cr.Company_ID_Kestone      || "",
            Affinity_ID_Dell:        cr.Affinity_ID_Dell        || "",
            Company_ID_Google:       cr.Company_ID_Google       || "",
            Company_Source:          cr.Company_Source          || "",
            Company_Name:            cn,
            Year_Founded:            cr.Year_Founded            || "",
            Turnover_Range:          cr.Turnover_Range          || "",
            Employees_Range:         cr.Employees_Range         || "",
            Industry:                cr.Industry                || "",
            Sub_Industry:            cr.Sub_Industry            || "",
            Company_Segment:         cr.Company_Segment         || "",
            Website:                 cr.Website                 || "",
            Company_LinkedIn_Profile: cr.Company_LinkedIn_Profile || "",
            Company_Phone1:          cr.Company_Phone1          || "",
            Company_Phone2:          cr.Company_Phone2          || "",
          },
        },
        upsert: true,
      },
    });
  }

  if (newCompanyOps.length > 0) {
    for (let i = 0; i < newCompanyOps.length; i += 500) {
      const result = await Company.bulkWrite(newCompanyOps.slice(i, i + 500), {
        ordered: false,
        writeConcern: { w: 1 },
      });
      job.progress.companiesCreated += result.upsertedCount;
    }

    // Fetch the _ids of newly created companies and merge into companyMap
    const newNames = newCompanyOps.map((op) => op.updateOne.filter.Company_Name);
    const newDocs  = await Company.find(
      { Company_Name: { $in: newNames } },
      { Company_Name: 1 }
    ).lean();
    for (const c of newDocs) companyMap.set(c.Company_Name, c._id);
  }

  // ── Step 4: Build contact insert ops ──
  const contactOps = [];

  for (const r of validRows) {
    const companyId = companyMap.get(safeStr(r.Company_Name));
    if (!companyId) {
      // Company upsert succeeded but _id fetch failed (very rare edge case)
      job.progress.failed++;
      job.progress.failReasons.companyNotFound++;
      continue;
    }

    // Auto-generate Contact_ID if missing
    if (!r.Contact_ID || safeStr(r.Contact_ID) === "") {
      lastNumber++;
      r.Contact_ID = `CEP-A-${String(lastNumber).padStart(6, "0")}`;
    }

    const p1  = safeStr(r.Contact_Direct_Phone1);
    const p2  = safeStr(r.Contact_Direct_Phone2);
    const mob = safeStr(r.Mobile_No);
    const e1  = safeStr(r.Personal_Email1).toLowerCase();
    const e2  = safeStr(r.Personal_Email2).toLowerCase();
    const oe1 = safeStr(r.Office_Email_1).toLowerCase();
    const oe2 = safeStr(r.Office_Email_2).toLowerCase();

    contactOps.push({
      updateOne: {
        filter: { Contact_ID: r.Contact_ID },
        update: {
          $set: {
            Contact_ID:               safeStr(r.Contact_ID),
            Contact_Source:           safeStr(r.Contact_Source),
            Contact_Create_Date:      parseDateVal(r.Contact_Create_Date),
            Salutation:               safeStr(r.Salutation),
            First_Name:               safeStr(r.First_Name),
            Last_Name:                safeStr(r.Last_Name),
            Full_Name:                safeStr(r.Full_Name),
            Gender:                   safeStr(r.Gender),
            Job_Title:                safeStr(r.Job_Title),
            Job_Seniority:            safeStr(r.Job_Seniority),
            Job_Function:             safeStr(r.Job_Function),
            Contact_Address_1:        safeStr(r.Contact_Address_1),
            Contact_Address_2:        safeStr(r.Contact_Address_2),
            Contact_Address_3:        safeStr(r.Contact_Address_3),
            Contact_City:             safeStr(r.Contact_City),
            Contact_Pin:              safeStr(r.Contact_Pin),
            Contact_State:            safeStr(r.Contact_State),
            Contact_Region:           safeStr(r.Contact_Region),
            Contact_Country:          safeStr(r.Contact_Country),
            Contact_STD_ISD_Code:     safeStr(r.Contact_STD_ISD_Code),
            Contact_Location_Tier:    safeStr(r.Contact_Location_Tier),
            Contact_Direct_Phone1:    p1,
            Contact_Direct_Phone2:    p2,
            Contact_Extn_No:          safeStr(r.Contact_Extn_No),
            Mobile_No:                mob,
            Office_Email_1:           oe1,
            Office_Email_2:           oe2,
            Personal_Email1:          e1,
            Personal_Email2:          e2,
            Contact_LinkedIn_Profile: safeStr(r.Contact_LinkedIn_Profile),
            Unsubscribe_Flag:         safeStr(r["Unsubscribe Flag (Yes/No)"]),
            Unsubscribe_Account_Tag:  safeStr(r.Unsubscribe_Account_Tag),
            DND_Flag:                 safeStr(r["DND Flag (Yes/No)"]),
            DND_Account_Tag:          safeStr(r.DND_Account_Tag),
            Last_Engagement:          safeStr(r.Last_Engagement),
            Last_Engagement_Date:     parseDateVal(r.Last_Engagement_Date),
            Last_Engagement_Campaign: safeStr(r.Last_Engagement_Campaign),
            Telecalling_Remarks:      safeStr(r.Telecalling_Remarks),
            BatchName:                batchName,
            Company_ID:               companyId,
          },
        },
        upsert: true,
      },
    });
  }

  // Write contacts in sub-chunks of 2000
  for (let i = 0; i < contactOps.length; i += 2000) {
    const slice  = contactOps.slice(i, i + 2000);
    const result = await Contact.bulkWrite(slice, {
      ordered: false,
      writeConcern: { w: 1 },
    });
    job.progress.inserted  += result.upsertedCount;
    job.progress.updated   += result.modifiedCount;
    job.progress.processed += slice.length;
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
      hyperlinks:    "ignore",
      styles:        "ignore",
      formulae:      "ignore",
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

    let headers   = null;
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
          rowBuffer  = [];
          console.log(`[Job ${jobId}] Streamed ${job.progress.totalRows} rows so far...`);
        }
      }
      break; // Only first sheet
    }

    // Flush remaining rows
    if (rowBuffer.length > 0) {
      await processChunk(rowBuffer, batchName, lastNumber, job);
    }

    fs.unlink(filePath, () => {});
    job.status      = "completed";
    job.completedAt = new Date();
    console.log(
      `[Job ${jobId}] Done. Total: ${job.progress.totalRows}, ` +
      `Inserted: ${job.progress.inserted}, Updated: ${job.progress.updated}, ` +
      `Duplicates: ${job.progress.duplicates}, Failed: ${job.progress.failed}`
    );
  } catch (err) {
    job.status      = "failed";
    job.error       = err.message;
    job.completedAt = new Date();
    console.error(`[Job ${jobId}] Failed:`, err);
    fs.unlink(filePath, () => {});
  }
}
