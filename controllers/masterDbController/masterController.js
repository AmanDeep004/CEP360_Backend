import XLSX from "xlsx";
import fs from "fs";
import errorHandler from "../../utils/index.js";
import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import CompanyHistory from "../../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../../models/MasterDBModel/contactHistory.js";
import CallHistory from "../../models/callHistoryModel.js";
import CallingData from "../../models/callingDataModal.js";
import Campaign from "../../models/campaignModel.js";
import dumpHistoryData from "../../models/MasterDBModel/dumpHistoryDataModel.js";
import EngagementHistory from "../../models/MasterDBModel/enagagementHistoryModel.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

function parseDate(value) {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();
  if (["blank", "null", "", "na"].includes(str)) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const batchCreateFromExcelOld = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // 1. Parse Excel (keep original headers)
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let skippedContacts = 0;
    let contactsCreated = 0;
    let companiesCreated = 0;
    const skippedLogs = [];

    // Parse date function
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // --- Step 1: Collect all unique companies ---
    const uniqueCompanies = new Set();
    const companyRowMap = new Map(); // Cache first occurrence of each company

    for (const r of rows) {
      if (r.Company_Name && r.Company_Name.trim()) {
        const companyName = r.Company_Name.trim();
        uniqueCompanies.add(companyName);
        if (!companyRowMap.has(companyName)) {
          companyRowMap.set(companyName, r);
        }
      }
    }

    // --- Step 2: Bulk upsert companies ---
    const companyOps = [];
    for (const companyName of uniqueCompanies) {
      const companyRow = companyRowMap.get(companyName);

      companyOps.push({
        updateOne: {
          filter: { Company_Name: companyName },
          update: {
            $set: {
              Company_ID_Kestone: companyRow.Company_ID_Kestone || "",
              Affinity_ID_Dell: companyRow.Affinity_ID_Dell || "",
              Company_ID_Google: companyRow.Company_ID_Google || "",
              Company_Source: companyRow.Company_Source || "",
              Company_Name: companyRow.Company_Name,
              Year_Founded: companyRow.Year_Founded || "",
              Turnover_Range: companyRow.Turnover_Range || "",
              Employees_Range: companyRow.Employees_Range || "",
              Industry: companyRow.Industry || "",
              Sub_Industry: companyRow.Sub_Industry || "",
              Company_Segment: companyRow.Company_Segment || "",
              Website: companyRow.Website || "",
              Company_LinkedIn_Profile:
                companyRow.Company_LinkedIn_Profile || "",
              Company_Phone1: companyRow.Company_Phone1 || "",
              Company_Phone2: companyRow.Company_Phone2 || "",
            },
          },
          upsert: true,
        },
      });
    }

    // Process companies in chunks
    const companyChunkSize = 1000;
    for (let i = 0; i < companyOps.length; i += companyChunkSize) {
      const chunk = companyOps.slice(i, i + companyChunkSize);
      const companyResult = await Company.bulkWrite(chunk, {
        ordered: false,
        writeConcern: { w: 1 },
      });
      companiesCreated += companyResult.upsertedCount;
    }

    // --- Step 3: Get company mapping in one query ---
    const allCompanyDocs = await Company.find(
      { Company_Name: { $in: [...uniqueCompanies] } },
      { Company_Name: 1 }
    ).lean();

    const companyMap = new Map();
    for (const c of allCompanyDocs) {
      companyMap.set(c.Company_Name, c._id);
    }

    // --- Step 4: Bulk duplicate check optimization ---
    // Helper function to safely convert to string and trim
    const safeString = (value) => {
      if (value == null || value === "") return "";
      return String(value).trim();
    };

    // Collect all unique phone numbers and emails from the Excel data
    const phonesToCheck = new Set();
    const emailsToCheck = new Set();

    for (const r of rows) {
      const phone1 = safeString(r.Contact_Direct_Phone1);
      const phone2 = safeString(r.Contact_Direct_Phone2);
      const email1 = safeString(r.Personal_Email1);
      const email2 = safeString(r.Personal_Email2);

      if (phone1) phonesToCheck.add(phone1);
      if (phone2) phonesToCheck.add(phone2);
      if (email1) emailsToCheck.add(email1.toLowerCase());
      if (email2) emailsToCheck.add(email2.toLowerCase());
    }

    // Single query to find all existing duplicates
    const existingContacts = await Contact.find(
      {
        $or: [
          { Contact_Direct_Phone1: { $in: [...phonesToCheck] } },
          { Contact_Direct_Phone2: { $in: [...phonesToCheck] } },
          { Personal_Email1: { $in: [...emailsToCheck] } },
          { Personal_Email2: { $in: [...emailsToCheck] } },
        ],
      },
      {
        Contact_Direct_Phone1: 1,
        Contact_Direct_Phone2: 1,
        Personal_Email1: 1,
        Personal_Email2: 1,
        Contact_ID: 1,
      }
    ).lean();

    // Create lookup maps for O(1) duplicate checking
    const duplicatePhoneMap = new Set();
    const duplicateEmailMap = new Set();

    for (const contact of existingContacts) {
      if (contact.Contact_Direct_Phone1)
        duplicatePhoneMap.add(contact.Contact_Direct_Phone1);
      if (contact.Contact_Direct_Phone2)
        duplicatePhoneMap.add(contact.Contact_Direct_Phone2);
      if (contact.Personal_Email1)
        duplicateEmailMap.add(contact.Personal_Email1);
      if (contact.Personal_Email2)
        duplicateEmailMap.add(contact.Personal_Email2);
    }

    // --- Step 5: Build contact bulk ops with optimized duplicate checks ---
    const contactOps = [];
    const validRows = []; // Pre-filter valid rows

    // Pre-filter and validate rows
    for (const r of rows) {
      if (!r.Contact_ID || !r.Company_Name) {
        skippedContacts++;
        skippedLogs.push({
          reason: "Missing Contact_ID or Company_Name",
          Contact_ID: r.Contact_ID || "N/A",
          Company_Name: r.Company_Name || "N/A",
        });
        continue;
      }

      const companyId = companyMap.get(r.Company_Name);
      if (!companyId) {
        skippedContacts++;
        skippedLogs.push({
          reason: "Company not found after upsert",
          Contact_ID: r.Contact_ID,
          Company_Name: r.Company_Name,
        });
        continue;
      }

      // Fast duplicate check using pre-built maps
      let isDuplicate = false;
      let duplicateReason = "";

      const phone1 = safeString(r.Contact_Direct_Phone1);
      const phone2 = safeString(r.Contact_Direct_Phone2);
      const email1 = safeString(r.Personal_Email1);
      const email2 = safeString(r.Personal_Email2);

      if (phone1 && duplicatePhoneMap.has(phone1)) {
        isDuplicate = true;
        duplicateReason = "Contact_Direct_Phone1 exists";
      } else if (phone2 && duplicatePhoneMap.has(phone2)) {
        isDuplicate = true;
        duplicateReason = "Contact_Direct_Phone2 exists";
      } else if (email1 && duplicateEmailMap.has(email1.toLowerCase())) {
        isDuplicate = true;
        duplicateReason = "Personal_Email1 exists";
      } else if (email2 && duplicateEmailMap.has(email2.toLowerCase())) {
        isDuplicate = true;
        duplicateReason = "Personal_Email2 exists";
      }

      if (isDuplicate) {
        skippedContacts++;
        skippedLogs.push({
          reason: `Duplicate: ${duplicateReason}`,
          Contact_ID: r.Contact_ID,
          Company_Name: r.Company_Name,
        });
        continue;
      }

      validRows.push({ row: r, companyId });
    }

    // Build bulk operations for valid rows
    for (const { row: r, companyId } of validRows) {
      contactOps.push({
        updateOne: {
          filter: { Contact_ID: r.Contact_ID },
          update: {
            $set: {
              Contact_ID: safeString(r.Contact_ID),
              Contact_Source: safeString(r.Contact_Source),
              Contact_Create_Date: parseDate(r.Contact_Create_Date),
              Salutation: safeString(r.Salutation),
              First_Name: safeString(r.First_Name),
              Last_Name: safeString(r.Last_Name),
              Full_Name: safeString(r.Full_Name),
              Gender: safeString(r.Gender),
              Job_Title: safeString(r.Job_Title),
              Job_Seniority: safeString(r.Job_Seniority),
              Job_Function: safeString(r.Job_Function),

              // Address fields
              Contact_Address_1: safeString(r.Contact_Address_1),
              Contact_Address_2: safeString(r.Contact_Address_2),
              Contact_Address_3: safeString(r.Contact_Address_3),
              Contact_City: safeString(r.Contact_City),
              Contact_Pin: safeString(r.Contact_Pin),
              Contact_State: safeString(r.Contact_State),
              Contact_Region: safeString(r.Contact_Region),
              Contact_Country: safeString(r.Contact_Country),
              Contact_STD_ISD_Code: safeString(r.Contact_STD_ISD_Code),
              Contact_Location_Tier: safeString(r.Contact_Location_Tier),

              // Phone fields
              Contact_Direct_Phone1: safeString(r.Contact_Direct_Phone1),
              Contact_Direct_Phone2: safeString(r.Contact_Direct_Phone2),
              Contact_Extn_No: safeString(r.Contact_Extn_No),
              Mobile_No: safeString(r.Mobile_No),

              // Email fields (convert to lowercase)
              Office_Email_1: safeString(r.Office_Email_1).toLowerCase(),
              Office_Email_2: safeString(r.Office_Email_2).toLowerCase(),
              Personal_Email1: safeString(r.Personal_Email1).toLowerCase(),
              Personal_Email2: safeString(r.Personal_Email2).toLowerCase(),

              Contact_LinkedIn_Profile: safeString(r.Contact_LinkedIn_Profile),

              // Flags (handle Yes/No values)
              Unsubscribe_Flag: safeString(r["Unsubscribe Flag (Yes/No)"]),
              Unsubscribe_Account_Tag: safeString(r.Unsubscribe_Account_Tag),
              DND_Flag: safeString(r["DND Flag (Yes/No)"]),
              DND_Account_Tag: safeString(r.DND_Account_Tag),

              // Engagement fields
              Last_Engagement: safeString(r.Last_Engagement),
              Last_Engagement_Date: parseDate(r.Last_Engagement_Date),
              Last_Engagement_Campaign: safeString(r.Last_Engagement_Campaign),
              Telecalling_Remarks: safeString(r.Telecalling_Remarks),

              // Batch and company reference
              BatchName: req.body.batchName || "default_batch",
              Company_ID: companyId,
            },
          },
          upsert: true,
        },
      });
    }

    // --- Step 6: Process contacts in optimized chunks ---
    const contactChunkSize = 2000; // Larger chunks for better performance
    const promises = [];

    // Process chunks in parallel (but limit concurrency)
    const maxConcurrency = 3;

    for (let i = 0; i < contactOps.length; i += contactChunkSize) {
      const chunk = contactOps.slice(i, i + contactChunkSize);

      const promise = Contact.bulkWrite(chunk, {
        ordered: false,
        writeConcern: { w: 1 }, // Faster write concern
      }).then((result) => {
        contactsCreated += result.upsertedCount;
      });

      promises.push(promise);

      // Limit concurrent operations
      if (promises.length >= maxConcurrency) {
        await Promise.all(promises);
        promises.length = 0; // Clear array
      }
    }

    // Wait for remaining promises
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // Clean up uploaded file (don't wait for it)
    if (req.file?.path) {
      import("fs")
        .then(({ unlink }) => {
          unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting file:", err);
          });
        })
        .catch(() => {});
    }

    return sendResponse(res, 200, "Batch insert successful", {
      totalRows: rows.length,
      companiesProcessed: companyOps.length,
      companiesCreated,
      contactsProcessed: contactOps.length,
      contactsCreated,
      skippedContacts,
      processingTimeOptimized: true,
      // skippedLogs,
      skippedLogs: skippedLogs.slice(0, 10), // Reduced for faster response
    });
  } catch (err) {
    console.error("Batch insert error:", err);

    // Non-blocking file cleanup
    if (req.file?.path) {
      import("fs")
        .then(({ unlink }) => {
          unlink(req.file.path, () => {});
        })
        .catch(() => {});
    }

    return sendError(next, err.message || "Batch insert failed", 500);
  }
});
const batchCreateFromExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // 1. Parse Excel (keep original headers)
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let skippedContacts = 0;
    let contactsCreated = 0;
    let companiesCreated = 0;
    const skippedLogs = [];

    // Parse date function
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // --- Step 1: Collect all unique companies ---
    const uniqueCompanies = new Set();
    const companyRowMap = new Map(); // Cache first occurrence of each company

    for (const r of rows) {
      if (r.Company_Name && r.Company_Name.trim()) {
        const companyName = r.Company_Name.trim();
        uniqueCompanies.add(companyName);
        if (!companyRowMap.has(companyName)) {
          companyRowMap.set(companyName, r);
        }
      }
    }

    // --- Step 2: Bulk upsert companies ---
    const companyOps = [];
    for (const companyName of uniqueCompanies) {
      const companyRow = companyRowMap.get(companyName);

      companyOps.push({
        updateOne: {
          filter: { Company_Name: companyName },
          update: {
            $set: {
              Company_ID_Kestone: companyRow.Company_ID_Kestone || "",
              Affinity_ID_Dell: companyRow.Affinity_ID_Dell || "",
              Company_ID_Google: companyRow.Company_ID_Google || "",
              Company_Source: companyRow.Company_Source || "",
              Company_Name: companyRow.Company_Name,
              Year_Founded: companyRow.Year_Founded || "",
              Turnover_Range: companyRow.Turnover_Range || "",
              Employees_Range: companyRow.Employees_Range || "",
              Industry: companyRow.Industry || "",
              Sub_Industry: companyRow.Sub_Industry || "",
              Company_Segment: companyRow.Company_Segment || "",
              Website: companyRow.Website || "",
              Company_LinkedIn_Profile:
                companyRow.Company_LinkedIn_Profile || "",
              Company_Phone1: companyRow.Company_Phone1 || "",
              Company_Phone2: companyRow.Company_Phone2 || "",
            },
          },
          upsert: true,
        },
      });
    }

    // Process companies in chunks
    const companyChunkSize = 1000;
    for (let i = 0; i < companyOps.length; i += companyChunkSize) {
      const chunk = companyOps.slice(i, i + companyChunkSize);
      const companyResult = await Company.bulkWrite(chunk, {
        ordered: false,
        writeConcern: { w: 1 },
      });
      companiesCreated += companyResult.upsertedCount;
    }

    // --- Step 3: Get company mapping in one query ---
    const allCompanyDocs = await Company.find(
      { Company_Name: { $in: [...uniqueCompanies] } },
      { Company_Name: 1 }
    ).lean();

    const companyMap = new Map();
    for (const c of allCompanyDocs) {
      companyMap.set(c.Company_Name, c._id);
    }

    // --- Step 4: Bulk duplicate check optimization ---
    const safeString = (value) => {
      if (value == null || value === "") return "";
      return String(value).trim();
    };

    const phonesToCheck = new Set();
    const emailsToCheck = new Set();

    for (const r of rows) {
      const phone1 = safeString(r.Contact_Direct_Phone1);
      const phone2 = safeString(r.Contact_Direct_Phone2);
      const email1 = safeString(r.Personal_Email1);
      const email2 = safeString(r.Personal_Email2);

      if (phone1) phonesToCheck.add(phone1);
      if (phone2) phonesToCheck.add(phone2);
      if (email1) emailsToCheck.add(email1.toLowerCase());
      if (email2) emailsToCheck.add(email2.toLowerCase());
    }

    const existingContacts = await Contact.find(
      {
        $or: [
          { Contact_Direct_Phone1: { $in: [...phonesToCheck] } },
          { Contact_Direct_Phone2: { $in: [...phonesToCheck] } },
          { Personal_Email1: { $in: [...emailsToCheck] } },
          { Personal_Email2: { $in: [...emailsToCheck] } },
        ],
      },
      {
        Contact_Direct_Phone1: 1,
        Contact_Direct_Phone2: 1,
        Personal_Email1: 1,
        Personal_Email2: 1,
        Contact_ID: 1,
      }
    ).lean();

    const duplicatePhoneMap = new Set();
    const duplicateEmailMap = new Set();

    for (const contact of existingContacts) {
      if (contact.Contact_Direct_Phone1)
        duplicatePhoneMap.add(contact.Contact_Direct_Phone1);
      if (contact.Contact_Direct_Phone2)
        duplicatePhoneMap.add(contact.Contact_Direct_Phone2);
      if (contact.Personal_Email1)
        duplicateEmailMap.add(contact.Personal_Email1.toLowerCase());
      if (contact.Personal_Email2)
        duplicateEmailMap.add(contact.Personal_Email2.toLowerCase());
    }

    // ---  Step 5a: Get latest sequential Contact_ID before processing ---
    const lastContact = await Contact.findOne({}, { Contact_ID: 1 })
      .sort({ _id: -1 })
      .lean();

    let lastNumber = 0;
    if (lastContact?.Contact_ID) {
      const match = lastContact.Contact_ID.match(/CEP-A-(\d+)/);
      if (match) lastNumber = parseInt(match[1]);
    }

    // --- Step 5b: Build contact bulk ops with optimized duplicate checks ---
    const contactOps = [];
    const validRows = [];

    for (const r of rows) {
      // Only skip if Company_Name is missing
      if (!r.Company_Name) {
        skippedContacts++;
        skippedLogs.push({
          reason: "Missing Company_Name",
          Contact_ID: r.Contact_ID || "N/A",
          Company_Name: r.Company_Name || "N/A",
        });
        continue;
      }

      // Generate Contact_ID sequentially if missing
      if (!r.Contact_ID || String(r.Contact_ID).trim() === "") {
        lastNumber += 1;
        r.Contact_ID = `CEP-A-${String(lastNumber).padStart(6, "0")}`;
      }

      const companyId = companyMap.get(r.Company_Name);
      if (!companyId) {
        skippedContacts++;
        skippedLogs.push({
          reason: "Company not found after upsert",
          Contact_ID: r.Contact_ID,
          Company_Name: r.Company_Name,
        });
        continue;
      }

      let isDuplicate = false;
      let duplicateReason = "";

      const phone1 = safeString(r.Contact_Direct_Phone1);
      const phone2 = safeString(r.Contact_Direct_Phone2);
      const email1 = safeString(r.Personal_Email1);
      const email2 = safeString(r.Personal_Email2);

      if (phone1 && duplicatePhoneMap.has(phone1)) {
        isDuplicate = true;
        duplicateReason = "Contact_Direct_Phone1 exists";
      } else if (phone2 && duplicatePhoneMap.has(phone2)) {
        isDuplicate = true;
        duplicateReason = "Contact_Direct_Phone2 exists";
      } else if (email1 && duplicateEmailMap.has(email1.toLowerCase())) {
        isDuplicate = true;
        duplicateReason = "Personal_Email1 exists";
      } else if (email2 && duplicateEmailMap.has(email2.toLowerCase())) {
        isDuplicate = true;
        duplicateReason = "Personal_Email2 exists";
      }

      if (isDuplicate) {
        skippedContacts++;
        skippedLogs.push({
          reason: `Duplicate: ${duplicateReason}`,
          Contact_ID: r.Contact_ID,
          Company_Name: r.Company_Name,
        });
        continue;
      }

      validRows.push({ row: r, companyId });
    }

    // --- Step 6: Build and insert contacts ---
    for (const { row: r, companyId } of validRows) {
      contactOps.push({
        updateOne: {
          filter: { Contact_ID: r.Contact_ID },
          update: {
            $set: {
              Contact_ID: safeString(r.Contact_ID),
              Contact_Source: safeString(r.Contact_Source),
              Contact_Create_Date: parseDate(r.Contact_Create_Date),
              Salutation: safeString(r.Salutation),
              First_Name: safeString(r.First_Name),
              Last_Name: safeString(r.Last_Name),
              Full_Name: safeString(r.Full_Name),
              Gender: safeString(r.Gender),
              Job_Title: safeString(r.Job_Title),
              Job_Seniority: safeString(r.Job_Seniority),
              Job_Function: safeString(r.Job_Function),
              Contact_Address_1: safeString(r.Contact_Address_1),
              Contact_Address_2: safeString(r.Contact_Address_2),
              Contact_Address_3: safeString(r.Contact_Address_3),
              Contact_City: safeString(r.Contact_City),
              Contact_Pin: safeString(r.Contact_Pin),
              Contact_State: safeString(r.Contact_State),
              Contact_Region: safeString(r.Contact_Region),
              Contact_Country: safeString(r.Contact_Country),
              Contact_STD_ISD_Code: safeString(r.Contact_STD_ISD_Code),
              Contact_Location_Tier: safeString(r.Contact_Location_Tier),
              Contact_Direct_Phone1: safeString(r.Contact_Direct_Phone1),
              Contact_Direct_Phone2: safeString(r.Contact_Direct_Phone2),
              Contact_Extn_No: safeString(r.Contact_Extn_No),
              Mobile_No: safeString(r.Mobile_No),
              Office_Email_1: safeString(r.Office_Email_1).toLowerCase(),
              Office_Email_2: safeString(r.Office_Email_2).toLowerCase(),
              Personal_Email1: safeString(r.Personal_Email1).toLowerCase(),
              Personal_Email2: safeString(r.Personal_Email2).toLowerCase(),
              Contact_LinkedIn_Profile: safeString(r.Contact_LinkedIn_Profile),
              Unsubscribe_Flag: safeString(r["Unsubscribe Flag (Yes/No)"]),
              Unsubscribe_Account_Tag: safeString(r.Unsubscribe_Account_Tag),
              DND_Flag: safeString(r["DND Flag (Yes/No)"]),
              DND_Account_Tag: safeString(r.DND_Account_Tag),
              Last_Engagement: safeString(r.Last_Engagement),
              Last_Engagement_Date: parseDate(r.Last_Engagement_Date),
              Last_Engagement_Campaign: safeString(r.Last_Engagement_Campaign),
              Telecalling_Remarks: safeString(r.Telecalling_Remarks),
              BatchName: req.body.batchName || "default_batch",
              Company_ID: companyId,
            },
          },
          upsert: true,
        },
      });
    }

    // --- Step 7: Process contacts in chunks ---
    const contactChunkSize = 2000;
    const promises = [];
    const maxConcurrency = 3;

    for (let i = 0; i < contactOps.length; i += contactChunkSize) {
      const chunk = contactOps.slice(i, i + contactChunkSize);
      const promise = Contact.bulkWrite(chunk, {
        ordered: false,
        writeConcern: { w: 1 },
      }).then((result) => {
        contactsCreated += result.upsertedCount;
      });
      promises.push(promise);
      if (promises.length >= maxConcurrency) {
        await Promise.all(promises);
        promises.length = 0;
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    if (req.file?.path) {
      import("fs")
        .then(({ unlink }) => unlink(req.file.path, () => {}))
        .catch(() => {});
    }

    return sendResponse(res, 200, "Batch insert successful", {
      totalRows: rows.length,
      companiesProcessed: companyOps.length,
      companiesCreated,
      contactsProcessed: contactOps.length,
      contactsCreated,
      skippedContacts,
      skippedLogs: skippedLogs.slice(0, 10),
      processingTimeOptimized: true,
    });
  } catch (err) {
    console.error("Batch insert error:", err);
    if (req.file?.path) {
      import("fs")
        .then(({ unlink }) => unlink(req.file.path, () => {}))
        .catch(() => {});
    }
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});

const getAllData = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit);
    const skip = (page - 1) * limit;

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;
    const search = filters.search;
    delete filters.search;

    let searchFilter = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      searchFilter = {
        $or: [
          { First_Name: regex },
          { Last_Name: regex },
          { Full_Name: regex },

          { Job_Title: regex },
          { Office_Email_1: regex },
          { Office_Email_2: regex },
          { Personal_Email1: regex },
          { Personal_Email2: regex },
          { Contact_Direct_Phone1: regex },
          { Contact_Direct_Phone2: regex },
          { Mobile_No: regex },
          { Contact_City: regex },
          { Contact_State: regex },
          { Contact_Country: regex },
        ],
      };
    }

    const finalFilter = Object.keys(searchFilter).length
      ? { ...filters, ...searchFilter }
      : filters;

    const [total, data] = await Promise.all([
      Contact.countDocuments(finalFilter),
      Contact.find(finalFilter)
        .populate(
          "Company_ID",
          "Company_Name Website Industry Company_Phone1 Company_Phone2"
        )
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Contacts fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

const getAllCompanyData = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit);
    const skip = (page - 1) * limit;

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;
    const search = filters.search;
    delete filters.search;

    let searchFilter = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      searchFilter = {
        $or: [
          { Company_Name: regex },
          { Year_Founded: regex },
          { Employees_Range: regex },
          { Industry: regex },
          { Sub_Industry: regex },
          { Company_Segment: regex },
          { Website: regex },
          { Company_LinkedIn_Profile: regex },
          { Company_Phone1: regex },
          { Company_Phone2: regex },
        ],
      };
    }

    // Combine filters and searchFilter
    const finalFilter = Object.keys(searchFilter).length
      ? { ...filters, ...searchFilter }
      : filters;

    const [total, data] = await Promise.all([
      Company.countDocuments(finalFilter),
      Company.find(finalFilter).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, "Companies fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

const getAllCompanyName = asyncHandler(async (req, res, next) => {
  try {
    const companies = await Company.find(
      {},
      { _id: 1, Company_Name: 1 }
    ).lean();

    return sendResponse(res, 200, "Companies fetched successfully", {
      total: companies.length,
      data: companies,
    });
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});
const getCompanyDataById = asyncHandler(async (req, res, next) => {
  try {
    const companyId = req.query.companyId; // <-- NEW

    // If companyId is passed → return one company directly
    if (companyId) {
      const company = await Company.findById(companyId).lean();
      if (!company) return sendError(next, "Company not found", 404);

      return sendResponse(res, 200, "Company fetched successfully", company);
    }

    // ✅ ELSE → Previous listing logic
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit);
    const skip = (page - 1) * limit;

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;
    delete filters.companyId; // remove new param from filters

    const search = filters.search;
    delete filters.search;

    let searchFilter = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      searchFilter = {
        $or: [
          { Company_Name: regex },
          { Year_Founded: regex },
          { Employees_Range: regex },
          { Industry: regex },
          { Sub_Industry: regex },
          { Company_Segment: regex },
          { Website: regex },
          { Company_LinkedIn_Profile: regex },
          { Company_Phone1: regex },
          { Company_Phone2: regex },
        ],
      };
    }

    const finalFilter = Object.keys(searchFilter).length
      ? { ...filters, ...searchFilter }
      : filters;

    const [total, data] = await Promise.all([
      Company.countDocuments(finalFilter),
      Company.find(finalFilter).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, "Companies fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

// const updateData = asyncHandler(async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const updatePayload = req.body;
//     const user = req.user;

//     const existing = await Contact.findById(id);
//     if (!existing) return sendError(next, "Contact not found", 404);

//     if (updatePayload.Company_ID) {
//       const company = await Company.findById(updatePayload.Company_ID);
//       if (!company) return sendError(next, "Invalid Company_ID", 400);
//     }

//     const updatedFields = Object.keys(updatePayload).filter((field) => {
//       return (
//         String(existing[field] ?? "") !== String(updatePayload[field] ?? "")
//       );
//     });

//     if (updatedFields.length === 0) {
//       return sendResponse(res, 200, "No changes detected", existing);
//     }

//     await ContactHistory.create({
//       contact_id: existing._id,
//       snapshot: existing.toObject(),
//       updatedFields,
//       updatedBy: {
//         id: user._id,
//         name: user.employeeName,
//         email: user.email,
//         employeeCode: user.employeeCode,
//         role: user.role,
//         mobile: user.mobile,
//         location: user.location,
//         designation: user.designation,
//       },
//       changeType: "update",
//     });

//     const updatedContact = await Contact.findByIdAndUpdate(id, updatePayload, {
//       new: true,
//       runValidators: true,
//     }).populate("Company_ID", "Company_Name Website Industry");

//     return sendResponse(
//       res,
//       200,
//       "Contact updated successfully",
//       updatedContact
//     );
//   } catch (err) {
//     console.error("Update contact error:", err);
//     return sendError(next, err.message || "Update failed", 500);
//   }
// });
const updateData = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    const user = req.user;

    // 1️⃣ Try to find in Contact Collection
    let existingContact = await Contact.findById(id);

    if (existingContact) {
      // Create history: compare changed fields
      const changedFields = Object.keys(payload).filter(
        (key) =>
          String(existingContact[key] ?? "") !== String(payload[key] ?? "")
      );

      if (changedFields.length > 0) {
        await ContactHistory.create({
          contact_id: existingContact._id,
          snapshot: existingContact.toObject(),
          updatedFields: changedFields,
          updatedBy: {
            id: user._id,
            name: user.employeeName,
            email: user.email,
            employeeName: user.employeeName,
            role: user.role,
            mobile: user.mobile,
            location: user.location,
            designation: user.designation,
          },
          changeType: "update",
        });
      }

      const updatedContact = await Contact.findByIdAndUpdate(id, payload, {
        new: true,
        runValidators: true,
      }).populate("Company_ID", "Company_Name Website Industry");

      return sendResponse(
        res,
        200,
        "Contact updated successfully",
        updatedContact
      );
    }

    // 2️⃣ If not found in contact → Try to find in Company Collection
    let existingCompany = await Company.findById(id);

    if (existingCompany) {
      // Create history: compare changed fields
      const changedFields = Object.keys(payload).filter(
        (key) =>
          String(existingCompany[key] ?? "") !== String(payload[key] ?? "")
      );

      if (changedFields.length > 0) {
        await CompanyHistory.create({
          company_id: existingCompany._id,
          snapshot: existingCompany.toObject(),
          updatedFields: changedFields,
          updatedBy: {
            id: user._id,
            name: user.employeeName,
            email: user.email,
            employeeName: user.employeeName,
            role: user.role,
            mobile: user.mobile,
            location: user.location,
            designation: user.designation,
          },
          changeType: "update",
        });
      }

      const updatedCompany = await Company.findByIdAndUpdate(id, payload, {
        new: true,
        runValidators: true,
      });

      return sendResponse(
        res,
        200,
        "Company updated successfully",
        updatedCompany
      );
    }

    // 3️⃣ If not in both
    return sendError(next, "Record not found in Contact or Company", 404);
  } catch (err) {
    console.error("Update Error:", err);
    return sendError(next, err.message || "Update failed", 500);
  }
});
const createANewCompany = asyncHandler(async (req, res, next) => {
  try {
    const data = req.body;
    const user = req.user;

    if (!data.Company_Name || !data.Website) {
      return sendError(next, "Company name and website are required", 400);
    }

    const existing = await Company.findOne({
      Company_Name: data.Company_Name.trim(),
      Website: data.Website.trim(),
    });
    if (existing) {
      return sendError(
        next,
        "Company with this name and website already exists",
        400
      );
    }

    const newCompanyData = {
      Company_Name: data.Company_Name.trim(),
      Company_ID_Kestone: data.Company_ID_Kestone || "",
      Affinity_ID_Dell: data.Affinity_ID_Dell || "",
      Company_ID_Google: data.Company_ID_Google || "",
      Company_Source: data.Company_Source || "",
      Year_Founded: data.Year_Founded || "",
      Turnover_Range: data.Turnover_Range || "",
      Employees_Range: data.Employees_Range || "",
      Industry: data.Industry || "",
      Sub_Industry: data.Sub_Industry || "",
      Company_Segment: data.Company_Segment || "",
      Website: data.Website.trim(),
      Company_LinkedIn_Profile: data.Company_LinkedIn_Profile || "",
      Company_Phone1: data.Company_Phone1 || "",
      Company_Phone2: data.Company_Phone2 || "",
    };

    const company = await Company.create(newCompanyData);

    return sendResponse(res, 200, "Company created successfully", company);
  } catch (err) {
    return sendError(next, err.message || "Failed to create company", 500);
  }
});
const updateCompany = asyncHandler(async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const data = req.body;

    // Check if ID exists
    const company = await Company.findById(companyId);
    if (!company) {
      return sendError(next, "Company not found", 404);
    }

    // Validate fields
    if (data.Company_Name && data.Company_Name.trim() === "") {
      return sendError(next, "Company name cannot be empty", 400);
    }
    if (data.Website && data.Website.trim() === "") {
      return sendError(next, "Website cannot be empty", 400);
    }

    // Check duplicate (only if name or website changed)
    if (
      (data.Company_Name &&
        data.Company_Name.trim() !== company.Company_Name) ||
      (data.Website && data.Website.trim() !== company.Website)
    ) {
      const existing = await Company.findOne({
        Company_Name: (data.Company_Name || company.Company_Name).trim(),
        Website: (data.Website || company.Website).trim(),
        _id: { $ne: companyId }, // exclude current doc
      });

      if (existing) {
        return sendError(
          next,
          "Another company with this name and website already exists",
          400
        );
      }
    }

    // Prepare updated fields
    const updatedData = {
      Company_Name: data.Company_Name?.trim() ?? company.Company_Name,
      Company_ID_Kestone: data.Company_ID_Kestone ?? company.Company_ID_Kestone,
      Affinity_ID_Dell: data.Affinity_ID_Dell ?? company.Affinity_ID_Dell,
      Company_ID_Google: data.Company_ID_Google ?? company.Company_ID_Google,
      Company_Source: data.Company_Source ?? company.Company_Source,
      Year_Founded: data.Year_Founded ?? company.Year_Founded,
      Turnover_Range: data.Turnover_Range ?? company.Turnover_Range,
      Employees_Range: data.Employees_Range ?? company.Employees_Range,
      Industry: data.Industry ?? company.Industry,
      Sub_Industry: data.Sub_Industry ?? company.Sub_Industry,
      Company_Segment: data.Company_Segment ?? company.Company_Segment,
      Website: data.Website?.trim() ?? company.Website,
      Company_LinkedIn_Profile:
        data.Company_LinkedIn_Profile ?? company.Company_LinkedIn_Profile,
      Company_Phone1: data.Company_Phone1 ?? company.Company_Phone1,
      Company_Phone2: data.Company_Phone2 ?? company.Company_Phone2,
    };

    const updatedCompany = await Company.findByIdAndUpdate(
      companyId,
      updatedData,
      { new: true }
    );

    return sendResponse(
      res,
      200,
      "Company updated successfully",
      updatedCompany
    );
  } catch (err) {
    return sendError(next, err.message || "Failed to update company", 500);
  }
});

const getDropdownFilters = asyncHandler(async (req, res, next) => {
  try {
    const [companyFilters, contactFilters] = await Promise.all([
      Company.aggregate([
        {
          $group: {
            _id: null,
            industries: { $addToSet: "$Industry" },
            subIndustries: { $addToSet: "$Sub_Industry" },
            segments: { $addToSet: "$Company_Segment" },
            employeeRanges: { $addToSet: "$Employees_Range" },
            turnovers: { $addToSet: "$Turnover_Range" },
          },
        },
        {
          $project: {
            _id: 0,
            industries: {
              $filter: {
                input: "$industries",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            subIndustries: {
              $filter: {
                input: "$subIndustries",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            segments: {
              $filter: {
                input: "$segments",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            employeeRanges: {
              $filter: {
                input: "$employeeRanges",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            turnovers: {
              $filter: {
                input: "$turnovers",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
          },
        },
      ]),

      Contact.aggregate([
        {
          $group: {
            _id: null,
            countries: { $addToSet: "$Contact_Country" },
            states: { $addToSet: "$Contact_State" },
            regions: { $addToSet: "$Contact_Region" },
            cities: { $addToSet: "$Contact_City" },
            jobSeniorities: { $addToSet: "$Job_Seniority" },
            jobFunctions: { $addToSet: "$Job_Function" },
          },
        },
        {
          $project: {
            _id: 0,
            countries: {
              $filter: {
                input: "$countries",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            states: {
              $filter: {
                input: "$states",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            regions: {
              $filter: {
                input: "$regions",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            cities: {
              $filter: {
                input: "$cities",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            jobSeniorities: {
              $filter: {
                input: "$jobSeniorities",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
            jobFunctions: {
              $filter: {
                input: "$jobFunctions",
                as: "val",
                cond: {
                  $and: [
                    { $ne: ["$$val", null] },
                    { $ne: ["$$val", ""] },
                    { $ne: ["$$val", "Blank"] },
                  ],
                },
              },
            },
          },
        },
      ]),
    ]);

    const companyData = companyFilters[0] || {
      industries: [],
      subIndustries: [],
      segments: [],
      employeeRanges: [],
      turnovers: [],
    };

    const contactData = contactFilters[0] || {
      countries: [],
      states: [],
      regions: [],
      cities: [],
      jobSeniorities: [],
      jobFunctions: [],
    };

    const parseRange = (str) => {
      if (!str) return Infinity;

      const plusMatch = str.match(/^(\d+)[\s&+A-Za-z]*/);
      if (plusMatch) return parseInt(plusMatch[1], 10);

      if (str.includes("B")) return 10_000_000;

      const rangeMatch = str.match(/(\d+)\s*to\s*(\d+)/);
      if (rangeMatch) return parseInt(rangeMatch[1], 10);

      return Infinity;
    };

    companyData.turnovers = companyData.turnovers.sort(
      (a, b) => parseRange(a) - parseRange(b)
    );
    companyData.employeeRanges = companyData.employeeRanges.sort(
      (a, b) => parseRange(a) - parseRange(b)
    );

    companyData.industries = companyData.industries.sort();
    companyData.subIndustries = companyData.subIndustries.sort();
    companyData.segments = companyData.segments.sort();

    contactData.countries = contactData.countries.sort();
    contactData.states = contactData.states.sort();
    contactData.regions = contactData.regions.sort();
    contactData.cities = contactData.cities.sort();
    contactData.jobSeniorities = contactData.jobSeniorities.sort();
    contactData.jobFunctions = contactData.jobFunctions.sort();

    return sendResponse(res, 200, "Unique filters fetched successfully", {
      ...companyData,
      ...contactData,
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to fetch filters", 500);
  }
});

const getFiltersStats = asyncHandler(async (req, res, next) => {
  try {
    const {
      industries = [],
      companySize = [],
      regions = [],
      countries = [],
      departments = [],
      designations = [],
    } = req.body;

    const companyMatch = {};
    if (industries.length)
      companyMatch["company.Industry"] = { $in: industries };
    if (companySize.length)
      companyMatch["company.Employees_Range"] = { $in: companySize };

    const contactMatch = {};
    if (regions.length) contactMatch.Contact_Region = { $in: regions };
    if (countries.length) contactMatch.Contact_Country = { $in: countries };
    if (departments.length) contactMatch.Job_Function = { $in: departments };
    if (designations.length) contactMatch.Designation = { $in: designations };

    const result = await Contact.aggregate([
      {
        $lookup: {
          from: "companies",
          localField: "Company_ID",
          foreignField: "_id",
          as: "company",
        },
      },
      { $unwind: "$company" },
      { $match: { ...contactMatch, ...companyMatch } },
      {
        $group: {
          _id: { designation: "$Designation", department: "$Job_Function" },
          contactIds: { $addToSet: "$_id" },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.designation",
          departments: {
            $push: { department: "$_id.department", count: "$count" },
          },
          total: { $sum: "$count" },
          uniqueIds: { $push: "$contactIds" },
        },
      },
      {
        $addFields: {
          uniqueTotal: { $size: { $setUnion: "$uniqueIds" } },
        },
      },
      {
        $project: {
          _id: 0,
          designation: "$_id",
          total: 1,
          departments: 1,
          uniqueTotal: 1,
        },
      },
    ]);

    return sendResponse(res, 200, "Counts fetched successfully", result);
  } catch (err) {
    console.error("Aggregation error:", err);
    return sendError(next, err.message || "Failed to fetch counts", 500);
  }
});

const dumpAllHistoryData = asyncHandler(async (req, res, next) => {
  try {
    const histories = await CallHistory.find({}).lean();

    const result = [];

    for (const history of histories) {
      const lastChat =
        history.chatHistory && history.chatHistory.length > 0
          ? history.chatHistory[history.chatHistory.length - 1]
          : null;

      const callingData = await CallingData.findById(
        history.callingData_id
      ).lean();
      if (!callingData) continue;

      const campaign = await Campaign.findById(history.campaign_id).lean();
      if (!campaign) continue;

      const dumpData = {
        callHistory_id: history._id,
        callingData_id: callingData._id,
        campaign_id: campaign._id,

        Contact_ID: callingData.Contact_ID,
        Full_Name: callingData.Full_Name,
        Job_Title: callingData.Job_Title,
        Mobile_No: callingData.Mobile_No,
        Personal_Email1: callingData.Personal_Email1,
        Company_ID: callingData.Company_ID?.toString() || "",
        Company_Name: callingData.Company_Name,

        isRegistered: history.isRegistered,

        pmName: callingData.pmName || "",
        clientName: campaign.clientName || "",
        clientEmail: campaign.clientEmail || "",
        clientContact: campaign.clientContact || "",
        dataSourceType: callingData.dataSourceType || "",

        lastRemarks: lastChat?.remarks || "",
        lastCallingDate: lastChat?.callingDate || null,
        lastAgent_id: lastChat?.agent_id || null,
        lastAgentName: lastChat?.agentName || "",
      };

      await dumpHistoryData.create(dumpData);
      result.push(dumpData);
    }

    return sendResponse(res, 200, "Dump history saved successfully", {
      total: result.length,
      data: result,
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to dump history", 500);
  }
});
const migrateToEngagementHistoryOld = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }

    // Get campaign details
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    // Get all calling data for the campaign and populate call history and agentId
    const callingDataList = await CallingData.find({
      CampaignId: campaignId,
    })
      .populate("callHistory")
      .populate("agentId", "employeeName")
      .lean();

    if (!callingDataList || callingDataList.length === 0) {
      return sendError(next, "No calling data found for this campaign", 404);
    }

    const migrationResults = [];
    const errors = [];

    for (const callingData of callingDataList) {
      try {
        // Extract unique agent names from call history
        const uniqueAgentNames = [];
        if (callingData.callHistory?.chatHistory) {
          const agentNamesSet = new Set(
            callingData.callHistory.chatHistory
              .map((chat) => chat.agentName)
              .filter(Boolean)
          );
          uniqueAgentNames.push(...agentNamesSet);
        }

        // Also add the current agent name if exists
        if (callingData.agentId?.employeeName) {
          uniqueAgentNames.push(callingData.agentId.employeeName);
        }

        // Remove duplicates
        const finalAgentNames = [...new Set(uniqueAgentNames)];

        // Get last engagement date from call history
        let lastEngagementDate = null;
        if (
          callingData.callHistory?.chatHistory &&
          callingData.callHistory.chatHistory.length > 0
        ) {
          const lastChat =
            callingData.callHistory.chatHistory[
              callingData.callHistory.chatHistory.length - 1
            ];
          lastEngagementDate = lastChat.callingDate;
        }

        // Prepare engagement history data
        const engagementData = {
          contact_id: callingData.Contact_ID, // String contact ID
          callingDataId: callingData._id.toString(),
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,

          // Registration status
          isRegistered: callingData.callHistory?.isRegistered || false,
          isAtteneded: false, // Set based on your logic

          // WhatsApp history from CallingData.whatsappTemplates
          whatsappChatHistory: (callingData.whatsappTemplates || []).map(
            (template) => ({
              waMessageId: template.waMessageId,
              templateId: template.templateId,
              templateName: template.templateName,
              timestamp: template.timestamp,
              status: template.status,
              history: template.history || [],
            })
          ),

          // Email history from CallingData.emailTemplates
          emailHistory: callingData.emailTemplates
            ? {
                templateId: callingData.emailTemplates.templateId,
                templateName: callingData.emailTemplates.templateName,
                timestamp: callingData.emailTemplates.timestamp,
                status: callingData.emailTemplates.status,
                messageId: callingData.emailTemplates.messageId,
                history: callingData.emailTemplates.history || [],
              }
            : undefined,

          // Agent information - use populated agent name
          agentName: finalAgentNames,
          agentId: callingData.agentId?._id?.toString() || "",

          // Engagement date
          last_engagement_date: lastEngagementDate,

          // Telecalling remarks from CallHistory.chatHistory
          telecalling_remarks: (callingData.callHistory?.chatHistory || []).map(
            (chat) => ({
              contactNo: chat.contactNo,
              remarks: chat.remarks,
              reason: chat.reason,
              callingDate: chat.callingDate,
              isRegistered: chat.isRegistered,
              agent_id: chat.agent_id,
              agentName: chat.agentName,
            })
          ),
        };

        // Check if engagement history already exists for this contact and campaign
        const existingEngagement = await EngagementHistory.findOne({
          contact_id: callingData._id,
          campaignId: campaign._id.toString(),
        });

        if (existingEngagement) {
          // Update existing engagement history
          await EngagementHistory.findByIdAndUpdate(
            existingEngagement._id,
            engagementData,
            { new: true }
          );
          migrationResults.push({
            callingDataId: callingData._id,
            contactId: callingData.Contact_ID,
            status: "updated",
          });
        } else {
          // Create new engagement history
          await EngagementHistory.create(engagementData);
          migrationResults.push({
            callingDataId: callingData._id,
            contactId: callingData.Contact_ID,
            status: "created",
          });
        }
      } catch (error) {
        errors.push({
          callingDataId: callingData._id,
          contactId: callingData.Contact_ID,
          error: error.message,
        });
      }
    }

    return sendResponse(res, 200, "Migration completed successfully", {
      campaignId: campaign._id,
      campaignName: campaign.name,
      total: callingDataList.length,
      successful: migrationResults.length,
      failed: errors.length,
      results: migrationResults,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to migrate to engagement history",
      500
    );
  }
});

//api to migrate calling data history to masterdb
const migrateToEngagementHistory = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }

    // Get campaign details
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    // Get all calling data for the campaign and populate call history and agentId
    const callingDataList = await CallingData.find({
      CampaignId: campaignId,
    })
      .populate("callHistory")
      .populate("agentId", "employeeName")
      .lean();

    if (!callingDataList || callingDataList.length === 0) {
      return sendError(next, "No calling data found for this campaign", 404);
    }

    const migrationResults = [];
    const errors = [];

    for (const callingData of callingDataList) {
      try {
        // Extract unique agent names from call history
        const uniqueAgentNames = [];
        if (callingData.callHistory?.chatHistory) {
          const agentNamesSet = new Set(
            callingData.callHistory.chatHistory
              .map((chat) => chat.agentName)
              .filter(Boolean)
          );
          uniqueAgentNames.push(...agentNamesSet);
        }

        // Also add the current agent name if exists
        if (callingData.agentId?.employeeName) {
          uniqueAgentNames.push(callingData.agentId.employeeName);
        }

        // Remove duplicates
        const finalAgentNames = [...new Set(uniqueAgentNames)];

        // Get last engagement date from call history
        let lastEngagementDate = null;
        if (
          callingData.callHistory?.chatHistory &&
          callingData.callHistory.chatHistory.length > 0
        ) {
          const lastChat =
            callingData.callHistory.chatHistory[
              callingData.callHistory.chatHistory.length - 1
            ];
          lastEngagementDate = lastChat.callingDate;
        }
        // Prepare engagement history data
        const engagementData = {
          contact_id: callingData.Contact_ID, // String contact ID
          callingDataId: callingData._id.toString(),
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,

          // Registration status
          isRegistered: callingData?.isRegistered || false,
          registrationDate: callingData?.registeredOn || null,
          // isAtteneded: false, // Set based on your logic

          // WhatsApp history from CallingData.whatsappTemplates
          whatsappChatHistory: (callingData.whatsappTemplates || []).map(
            (template) => ({
              waMessageId: template.waMessageId,
              templateId: template.templateId,
              templateName: template.templateName,
              timestamp: template.timestamp,
              status: template.status,
              history: template.history || [],
            })
          ),

          // Email history from CallingData.emailTemplates
          emailHistory: callingData.emailTemplates
            ? {
                templateId: callingData.emailTemplates.templateId,
                templateName: callingData.emailTemplates.templateName,
                timestamp: callingData.emailTemplates.timestamp,
                status: callingData.emailTemplates.status,
                messageId: callingData.emailTemplates.messageId,
                history: callingData.emailTemplates.history || [],
              }
            : undefined,

          // Agent information - use populated agent name
          agentName: finalAgentNames,
          agentId: callingData.agentId?._id?.toString() || "",

          // Engagement date
          last_engagement_date: lastEngagementDate,

          // Telecalling remarks from CallHistory.chatHistory
          telecalling_remarks: (callingData.callHistory?.chatHistory || []).map(
            (chat) => ({
              contactNo: chat.contactNo,
              remarks: chat.remarks,
              reason: chat.reason,
              callingDate: chat.callingDate,
              isRegistered: chat.isRegistered,
              agent_id: chat.agent_id,
              agentName: chat.agentName,
            })
          ),
        };

        // Check if engagement history already exists for this contact and campaign
        const existingEngagement = await EngagementHistory.findOne({
          contact_id: callingData._id,
          campaignId: campaign._id.toString(),
        });

        if (existingEngagement) {
          // Update existing engagement history
          await EngagementHistory.findByIdAndUpdate(
            existingEngagement._id,
            engagementData,
            { new: true }
          );
          migrationResults.push({
            callingDataId: callingData._id,
            contactId: callingData.Contact_ID,
            status: "updated",
          });
        } else {
          // Create new engagement history
          await EngagementHistory.create(engagementData);
          migrationResults.push({
            callingDataId: callingData._id,
            contactId: callingData.Contact_ID,
            status: "created",
          });
        }

        //to push engagement points and last engagement details in contact collection
        console.log("engagementData:", engagementData);
        console.log("callingData.Contact_ID:", callingData);
        if (engagementData.isRegistered === true) {
          console.log("inside if condition");
          const res = await Contact.findOneAndUpdate(
            { Contact_ID: callingData.Contact_ID },
            {
              $inc: { EngagementPoints: 1 },
              $set: {
                Last_Engagement: "Registered",
                Last_Engagement_Date: callingData?.registeredOn,
                Last_Engagement_Campaign: campaign.name,
              },
            },
            { new: true }
          );

          console.log("Contact update result:", res);
        }
      } catch (error) {
        errors.push({
          callingDataId: callingData._id,
          contactId: callingData.Contact_ID,
          error: error.message,
        });
      }
    }

    return sendResponse(res, 200, "Migration completed successfully", {
      campaignId: campaign._id,
      campaignName: campaign.name,
      total: callingDataList.length,
      successful: migrationResults.length,
      failed: errors.length,
      results: migrationResults,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to migrate to engagement history",
      500
    );
  }
});

//api to get contacts with engagement histories
const getContactsWithEngagementsOld = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      campaignId = "",
      isRegistered,
      city,
      state,
      country,
      industry,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build contact query
    let contactQuery = {};

    // Search across multiple fields
    if (search) {
      contactQuery.$or = [
        { Contact_ID: { $regex: search, $options: "i" } },
        { Full_Name: { $regex: search, $options: "i" } },
        { First_Name: { $regex: search, $options: "i" } },
        { Last_Name: { $regex: search, $options: "i" } },
        { Office_Email_1: { $regex: search, $options: "i" } },
        { Personal_Email1: { $regex: search, $options: "i" } },
        { Mobile_No: { $regex: search, $options: "i" } },
        { Job_Title: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by location
    if (city) contactQuery.Contact_City = { $regex: city, $options: "i" };
    if (state) contactQuery.Contact_State = { $regex: state, $options: "i" };
    if (country)
      contactQuery.Contact_Country = { $regex: country, $options: "i" };

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count
    const totalContacts = await Contact.countDocuments(contactQuery);

    // Get contacts with company details
    const contacts = await Contact.find(contactQuery)
      .populate("Company_ID") // Populate company details
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Filter by industry if provided (after population)
    let filteredContacts = contacts;
    if (industry) {
      filteredContacts = contacts.filter(
        (contact) =>
          contact.Company_ID?.Industry &&
          contact.Company_ID.Industry.toLowerCase().includes(
            industry.toLowerCase()
          )
      );
    }

    // For each contact, get their engagements
    const contactsWithEngagements = await Promise.all(
      filteredContacts.map(async (contact) => {
        // Build engagement query
        let engagementQuery = { contact_id: contact.Contact_ID };

        // Filter engagements by campaign if provided
        if (campaignId) {
          engagementQuery.campaignId = campaignId;
        }

        // Filter engagements by registration status if provided
        if (isRegistered !== undefined) {
          engagementQuery.isRegistered = isRegistered === "true";
        }

        // Find all engagements for this contact
        const engagements = await EngagementHistory.find(engagementQuery)
          .sort({ last_engagement_date: -1 })
          .lean();

        // Calculate engagement statistics
        const totalEngagements = engagements.length;
        const hasEngagements = totalEngagements > 0;

        const isRegisteredInAnyCampaign = engagements.some(
          (eng) => eng.isRegistered == true
        );

        const campaignNames = [
          ...new Set(
            engagements.map((eng) => eng.campaignName).filter(Boolean)
          ),
        ];

        const allAgentNames = [
          ...new Set(
            engagements.flatMap((eng) => eng.agentName || []).filter(Boolean)
          ),
        ];

        const latestEngagementDate =
          engagements.length > 0 ? engagements[0].last_engagement_date : null;

        const totalTelecallingRemarks = engagements.reduce(
          (sum, eng) => sum + (eng.telecalling_remarks?.length || 0),
          0
        );

        const totalWhatsappMessages = engagements.reduce(
          (sum, eng) => sum + (eng.whatsappChatHistory?.length || 0),
          0
        );

        const totalEmailsSent = engagements.filter(
          (eng) => eng.emailHistory?.messageId
        ).length;

        return {
          ...contact,
          engagements,
          // Computed fields
          totalEngagements,
          hasEngagements,
          isRegisteredInAnyCampaign,
          campaignNames,
          allAgentNames,
          latestEngagementDate,
          totalTelecallingRemarks,
          totalWhatsappMessages,
          totalEmailsSent,
        };
      })
    );

    const totalPages = Math.ceil(totalContacts / limitNum);

    return sendResponse(res, 200, "Contacts fetched successfully", {
      contacts: contactsWithEngagements,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords: totalContacts,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        search,
        campaignId,
        isRegistered,
        city,
        state,
        country,
        industry,
      },
    });
  } catch (err) {
    console.error("Error in getContactsWithEngagements:", err);
    return sendError(
      next,
      err.message || "Failed to fetch contacts with engagements",
      500
    );
  }
});

const getContactsWithEngagementsWorking = asyncHandler(
  async (req, res, next) => {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        campaignId = "",
        isRegistered,
        city,
        state,
        country,
        industry,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      // Build contact query
      let contactQuery = {};

      // Search across multiple fields
      if (search && search.trim()) {
        const searchRegex = new RegExp(search.trim(), "i");
        contactQuery.$or = [
          { Contact_ID: searchRegex },
          { Full_Name: searchRegex },
          { First_Name: searchRegex },
          { Last_Name: searchRegex },
          { Office_Email_1: searchRegex },
          { Personal_Email1: searchRegex },
          { Mobile_No: searchRegex },
          { Job_Title: searchRegex },
        ];
      }

      // Filter by location
      if (city) contactQuery.Contact_City = { $regex: city, $options: "i" };
      if (state) contactQuery.Contact_State = { $regex: state, $options: "i" };
      if (country)
        contactQuery.Contact_Country = { $regex: country, $options: "i" };

      // Build sort object
      const sortObj = {};
      sortObj[sortBy] = sortOrder === "asc" ? 1 : -1;

      // PARALLEL QUERIES for better performance
      const [totalContacts, contacts] = await Promise.all([
        Contact.countDocuments(contactQuery).exec(),
        Contact.find(contactQuery)
          .populate({
            path: "Company_ID",
            select:
              "Company_Name Website Industry Sub_Industry Company_Phone1 Company_Phone2 Employees_Range Turnover_Range",
          })
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum)
          .lean()
          .exec(),
      ]);

      // Check if contacts exist
      if (!contacts || contacts.length === 0) {
        return sendResponse(res, 200, "No contacts found", {
          contacts: [],
          pagination: {
            currentPage: pageNum,
            totalPages: 0,
            totalRecords: 0,
            limit: limitNum,
            hasNextPage: false,
            hasPrevPage: false,
          },
          filters: {
            search,
            campaignId,
            isRegistered,
            city,
            state,
            country,
            industry,
          },
        });
      }

      // Filter by industry if provided (after population)
      let filteredContacts = contacts;
      if (industry && industry.trim()) {
        filteredContacts = contacts.filter(
          (contact) =>
            contact.Company_ID?.Industry &&
            contact.Company_ID.Industry.toLowerCase().includes(
              industry.toLowerCase()
            )
        );
      }

      // For each contact, get their engagements
      const contactsWithEngagements = await Promise.all(
        filteredContacts.map(async (contact) => {
          try {
            // Build engagement query
            let engagementQuery = { contact_id: contact.Contact_ID };

            // Filter engagements by campaign if provided
            if (campaignId && campaignId.trim()) {
              engagementQuery.campaignId = campaignId.trim();
            }

            // Filter engagements by registration status if provided
            if (isRegistered !== undefined && isRegistered !== null) {
              engagementQuery.isRegistered =
                isRegistered === "true" || isRegistered === true;
            }

            // Find all engagements for this contact with explicit exec()
            const engagements = await EngagementHistory.find(engagementQuery)
              .sort({ updatedAt: -1, createdAt: -1, last_engagement_date: -1 })
              .lean()
              .exec();

            // Calculate engagement statistics
            const totalEngagements = engagements?.length || 0;
            const hasEngagements = totalEngagements > 0;

            const isRegisteredInAnyCampaign = engagements
              ? engagements.some((eng) => eng.isRegistered === true)
              : false;

            const campaignNames = engagements
              ? [
                  ...new Set(
                    engagements.map((eng) => eng.campaignName).filter(Boolean)
                  ),
                ]
              : [];

            const allAgentNames = engagements
              ? [
                  ...new Set(
                    engagements
                      .flatMap((eng) => eng.agentName || [])
                      .filter(Boolean)
                  ),
                ]
              : [];

            const latestEngagementDate =
              engagements && engagements.length > 0
                ? engagements[0].last_engagement_date ||
                  engagements[0].updatedAt ||
                  engagements[0].createdAt
                : null;

            const totalTelecallingRemarks = engagements
              ? engagements.reduce(
                  (sum, eng) => sum + (eng.telecalling_remarks?.length || 0),
                  0
                )
              : 0;

            const totalWhatsappMessages = engagements
              ? engagements.reduce(
                  (sum, eng) => sum + (eng.whatsappChatHistory?.length || 0),
                  0
                )
              : 0;

            const totalEmailsSent = engagements
              ? engagements.filter((eng) => eng.emailHistory?.messageId).length
              : 0;

            return {
              ...contact,
              engagements: engagements || [],
              // Computed fields
              totalEngagements,
              hasEngagements,
              isRegisteredInAnyCampaign,
              campaignNames,
              allAgentNames,
              latestEngagementDate,
              totalTelecallingRemarks,
              totalWhatsappMessages,
              totalEmailsSent,
            };
          } catch (engagementError) {
            console.error(
              `Error fetching engagements for contact ${contact.Contact_ID}:`,
              engagementError
            );
            // Return contact without engagements if there's an error
            return {
              ...contact,
              engagements: [],
              totalEngagements: 0,
              hasEngagements: false,
              isRegisteredInAnyCampaign: false,
              campaignNames: [],
              allAgentNames: [],
              latestEngagementDate: null,
              totalTelecallingRemarks: 0,
              totalWhatsappMessages: 0,
              totalEmailsSent: 0,
            };
          }
        })
      );

      const totalPages = Math.ceil(totalContacts / limitNum);

      return sendResponse(res, 200, "Contacts fetched successfully", {
        contacts: contactsWithEngagements,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalRecords: totalContacts,
          limit: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
        filters: {
          search: search || "",
          campaignId: campaignId || "",
          isRegistered,
          city,
          state,
          country,
          industry,
        },
      });
    } catch (err) {
      console.error("Error in getContactsWithEngagements:", err);
      console.error("Error stack:", err.stack);
      return sendError(
        next,
        err.message || "Failed to fetch contacts with engagements",
        500
      );
    }
  }
);

const getContactsWithEngagements = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      campaignId = "",
      isRegistered,
      city,
      state,
      country,
      industry,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let contactQuery = {};

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      contactQuery.$or = [
        { Contact_ID: searchRegex },
        { Full_Name: searchRegex },
        { First_Name: searchRegex },
        { Last_Name: searchRegex },
        { Office_Email_1: searchRegex },
        { Personal_Email1: searchRegex },
        { Mobile_No: searchRegex },
        { Job_Title: searchRegex },
      ];
    }

    // Filter by location
    if (city) contactQuery.Contact_City = { $regex: city, $options: "i" };
    if (state) contactQuery.Contact_State = { $regex: state, $options: "i" };
    if (country)
      contactQuery.Contact_Country = { $regex: country, $options: "i" };

    const sortObj = {};
    sortObj[sortBy] = sortOrder === "asc" ? 1 : -1;

    // PARALLEL QUERIES for better performance
    const [totalContacts, contacts] = await Promise.all([
      Contact.countDocuments(contactQuery).exec(),
      Contact.find(contactQuery)
        .populate({
          path: "Company_ID",
          select:
            "Company_Name Website Industry Sub_Industry Company_Phone1 Company_Phone2 Employees_Range Turnover_Range",
        })
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(),
    ]);
    // Check if contacts exist
    if (!contacts || contacts.length === 0) {
      console.log("No contacts found, returning empty response");
      return sendResponse(res, 200, "No contacts found", {
        contacts: [],
        pagination: {
          currentPage: pageNum,
          totalPages: 0,
          totalRecords: 0,
          limit: limitNum,
          hasNextPage: false,
          hasPrevPage: false,
        },
        filters: {
          search,
          campaignId,
          isRegistered,
          city,
          state,
          country,
          industry,
        },
      });
    }

    // Filter by industry if provided (after population)
    let filteredContacts = contacts;
    if (industry && industry.trim()) {
      filteredContacts = contacts.filter(
        (contact) =>
          contact.Company_ID?.Industry &&
          contact.Company_ID.Industry.toLowerCase().includes(
            industry.toLowerCase()
          )
      );
    }

    // For each contact, get their engagements
    const contactsWithEngagements = await Promise.all(
      filteredContacts.map(async (contact, index) => {
        try {
          // Build engagement query
          let engagementQuery = { contact_id: contact.Contact_ID };

          console.log(
            `Base Engagement Query:`,
            JSON.stringify(engagementQuery)
          );

          // Filter engagements by campaign if provided
          if (campaignId && campaignId.trim()) {
            engagementQuery.campaignId = campaignId.trim();
            console.log(`Added campaignId filter: ${campaignId.trim()}`);
          }

          // Filter engagements by registration status if provided
          if (isRegistered !== undefined && isRegistered !== null) {
            engagementQuery.isRegistered =
              isRegistered === "true" || isRegistered === true;
            console.log(
              `Added isRegistered filter: ${engagementQuery.isRegistered}`
            );
          }

          console.log(
            `Final Engagement Query:`,
            JSON.stringify(engagementQuery, null, 2)
          );

          // Find all engagements for this contact with explicit exec()
          const engagements = await EngagementHistory.find(engagementQuery)
            .sort({ updatedAt: -1, createdAt: -1, last_engagement_date: -1 })
            .lean()
            .exec();

          console.log(`Engagements Found: ${engagements?.length || 0}`);

          if (engagements && engagements.length > 0) {
            console.log(`First Engagement Sample:`, {
              _id: engagements[0]._id,
              campaignName: engagements[0].campaignName,
              isRegistered: engagements[0].isRegistered,
              isAtteneded: engagements[0].isAtteneded,
              agentName: engagements[0].agentName,
              whatsappCount: engagements[0].whatsappChatHistory?.length || 0,
              emailExists: !!engagements[0].emailHistory?.messageId,
              telecallingCount: engagements[0].telecalling_remarks?.length || 0,
            });
          }

          // Calculate engagement statistics
          const totalEngagements = engagements?.length || 0;
          const hasEngagements = totalEngagements > 0;

          const isRegisteredInAnyCampaign = engagements
            ? engagements.some((eng) => eng.isRegistered === true)
            : false;

          const campaignNames = engagements
            ? [
                ...new Set(
                  engagements.map((eng) => eng.campaignName).filter(Boolean)
                ),
              ]
            : [];

          const allAgentNames = engagements
            ? [
                ...new Set(
                  engagements
                    .flatMap((eng) => eng.agentName || [])
                    .filter(Boolean)
                ),
              ]
            : [];

          const latestEngagementDate =
            engagements && engagements.length > 0
              ? engagements[0].last_engagement_date ||
                engagements[0].updatedAt ||
                engagements[0].createdAt
              : null;

          const totalTelecallingRemarks = engagements
            ? engagements.reduce(
                (sum, eng) => sum + (eng.telecalling_remarks?.length || 0),
                0
              )
            : 0;

          const totalWhatsappMessages = engagements
            ? engagements.reduce(
                (sum, eng) => sum + (eng.whatsappChatHistory?.length || 0),
                0
              )
            : 0;

          const totalEmailsSent = engagements
            ? engagements.filter((eng) => eng.emailHistory?.messageId).length
            : 0;

          console.log(`Computed Stats:`, {
            totalEngagements,
            hasEngagements,
            isRegisteredInAnyCampaign,
            campaignNames,
            allAgentNames,
            totalTelecallingRemarks,
            totalWhatsappMessages,
            totalEmailsSent,
          });

          const result = {
            ...contact,
            engagements: engagements || [],
            // Computed fields
            totalEngagements,
            hasEngagements,
            isRegisteredInAnyCampaign,
            campaignNames,
            allAgentNames,
            latestEngagementDate,
            totalTelecallingRemarks,
            totalWhatsappMessages,
            totalEmailsSent,
          };

          console.log(`Contact Result Keys:`, Object.keys(result));
          console.log(
            `Engagements in Result:`,
            result.engagements?.length || 0
          );

          return result;
        } catch (engagementError) {
          console.error(
            `Error fetching engagements for contact ${contact.Contact_ID}:`,
            engagementError
          );
          console.error(`Error Stack:`, engagementError.stack);

          // Return contact without engagements if there's an error
          return {
            ...contact,
            engagements: [],
            totalEngagements: 0,
            hasEngagements: false,
            isRegisteredInAnyCampaign: false,
            campaignNames: [],
            allAgentNames: [],
            latestEngagementDate: null,
            totalTelecallingRemarks: 0,
            totalWhatsappMessages: 0,
            totalEmailsSent: 0,
          };
        }
      })
    );
    console.log("contacts-aman", contactsWithEngagements);

    // Log summary of engagements
    const summaryStats = contactsWithEngagements.reduce(
      (acc, contact) => {
        acc.totalEngagements += contact.totalEngagements || 0;
        acc.totalWithEngagements += contact.hasEngagements ? 1 : 0;
        acc.totalRegistered += contact.isRegisteredInAnyCampaign ? 1 : 0;
        return acc;
      },
      { totalEngagements: 0, totalWithEngagements: 0, totalRegistered: 0 }
    );

    console.log(`Summary Stats:`, summaryStats);

    const totalPages = Math.ceil(totalContacts / limitNum);

    const response = {
      contacts: contactsWithEngagements,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords: totalContacts,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        search: search || "",
        campaignId: campaignId || "",
        isRegistered,
        city,
        state,
        country,
        industry,
      },
    };

    console.log(`Response Pagination:`, response.pagination);
    console.log(`=== END getContactsWithEngagements ===\n`);

    return sendResponse(res, 200, "Contacts fetched successfully", response);
  } catch (err) {
    console.error("CRITICAL ERROR in getContactsWithEngagements:", err);
    console.error("Error stack:", err.stack);
    return sendError(
      next,
      err.message || "Failed to fetch contacts with engagements",
      500
    );
  }
});

export {
  batchCreateFromExcel,
  getAllData,
  getAllCompanyData,
  updateData,
  createANewCompany,
  getAllCompanyName,
  getDropdownFilters,
  getFiltersStats,
  updateCompany,
  getCompanyDataById,
  dumpAllHistoryData,
  migrateToEngagementHistory,
  getContactsWithEngagements,
};
