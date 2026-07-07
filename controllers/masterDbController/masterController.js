import XLSX from "xlsx";
import fs from "fs";
import mongoose from "mongoose";
import errorHandler from "../../utils/index.js";
import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import CampaignFilter from "../../models/CallingDataFiltrationModel.js";
import CompanyHistory from "../../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../../models/MasterDBModel/contactHistory.js";
import CallHistory from "../../models/callHistoryModel.js";
import CallingData from "../../models/callingDataModal.js";
import Campaign from "../../models/campaignModel.js";
import dumpHistoryData from "../../models/MasterDBModel/dumpHistoryDataModel.js";
import EngagementHistory from "../../models/MasterDBModel/enagagementHistoryModel.js";
import CompanyMerge from "../../models/MasterDBModel/companyMergeModel.js";
import {
  jobStore,
  processExcelInBackground,
} from "../../services/excelStreamProcessor.js";
import { cacheGet, cacheSet, cacheInvalidatePattern } from "../../services/cache.js";
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

    const jobId = `job_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const batchName = req.body.batchName || "default_batch";

    jobStore.set(jobId, {
      status: "processing",
      startedAt: new Date(),
      progress: {
        totalRows: 0,
        processed: 0,
        inserted: 0, // new contacts added to DB
        updated: 0, // existing contacts updated
        duplicates: 0, // skipped — phone/email already exists
        failed: 0, // skipped — missing/unresolved company
        companiesCreated: 0, // new companies created (only for non-duplicate contacts)
        failReasons: {
          missingCompanyName: 0,
          companyNotFound: 0,
        },
      },
      error: null,
      completedAt: null,
    });

    // Invalidate dropdown cache — new data is about to be added to masterDB
    cacheInvalidatePattern("dropdown:*");

    // Respond immediately — don't wait for processing to finish
    res.status(202).json({
      success: true,
      message:
        "File accepted. Processing in background. Poll GET /api/masterdb/batchJobStatus/:jobId for progress.",
      jobId,
    });

    // Fire-and-forget background processing
    processExcelInBackground(jobId, req.file.path, batchName).catch((err) => {
      const job = jobStore.get(jobId);
      if (job) {
        job.status = "failed";
        job.error = err.message;
        job.completedAt = new Date();
      }
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getBatchJobStatus = asyncHandler(async (req, res, next) => {
  const { jobId } = req.params;
  const job = jobStore.get(jobId);

  if (!job) {
    return sendError(next, "Job not found or expired", 404);
  }

  const { progress } = job;
  return sendResponse(res, 200, "Job status fetched", {
    jobId,
    status: job.status, // "processing" | "completed" | "failed"
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    summary: {
      totalRows: progress.totalRows,
      inserted: progress.inserted,
      updated: progress.updated,
      duplicates: progress.duplicates,
      failed: progress.failed,
      companiesCreated: progress.companiesCreated,
    },
    failReasons: {
      missingCompanyName: progress.failReasons?.missingCompanyName ?? 0,
      companyNotFound: progress.failReasons?.companyNotFound ?? 0,
    },
    error: job.error || null,
    reportUrl: job.reportUrl || null,
  });
});

// ---- DEAD CODE BELOW (old synchronous implementation, kept for reference) ----
const _batchCreateFromExcel_OLD_SYNC = async (req, res, next) => {
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
};

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
      // Use MongoDB text index for fast full-text search (replaces slow $or regex scan)
      searchFilter = { $text: { $search: search.trim() } };
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
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
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
    const search = (req.query.search || "").trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    // Random sample for initial dropdown load (no search)
    if (req.query.random === "true" && !search) {
      const companies = await Company.aggregate([
        { $sample: { size: 25 } },
        { $project: { _id: 1, Company_Name: 1 } },
        { $sort: { Company_Name: 1 } },
      ]);
      return sendResponse(res, 200, "Companies fetched successfully", {
        total: companies.length,
        page: 1,
        limit: 25,
        hasMore: false,
        data: companies,
      });
    }

    // Normalize: treat commas as spaces, collapse whitespace, then split into tokens
    // Handles: "TATA", "tata steel", "Tata,Steel", "tata  steel", "TataSteel" etc.
    let filter = {};
    if (search) {
      const normalized = search.replace(/[,]+/g, " ").replace(/\s+/g, " ").trim();
      const words = normalized.split(" ").filter(Boolean);

      if (words.length > 1) {
        filter = {
          $or: [
            { Company_Name: new RegExp(normalized, "i") },       // full phrase
            ...words.map((w) => ({ Company_Name: new RegExp(w, "i") })), // each word
          ],
        };
      } else {
        filter = { Company_Name: new RegExp(normalized, "i") };
      }
    }

    const [total, companies] = await Promise.all([
      Company.countDocuments(filter),
      Company.find(filter, { _id: 1, Company_Name: 1 })
        .sort({ Company_Name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Companies fetched successfully", {
      total,
      page,
      limit,
      hasMore: skip + companies.length < total,
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
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
// Fields that must never be overwritten via the update API
const CONTACT_READONLY_FIELDS = [
  "Contact_ID", // unique identifier — must never change
  "EngagementPoints",
  "DND_Flag",
  "DND_Account_Tag",
  "Last_Engagement",
  "Last_Engagement_Date",
  "Last_Engagement_Campaign",
  "Telecalling_Remarks",
  "Unsubscribe_Account_Tag",
  "Unsubscribe_Flag",
  "discrepencyInData",
  "isRegisteredInAnyCampaign",
  "totalTelecallingRemarks",
  "totalWhatsappMessages",
  "totalEmailSent",
  "totalEngagements",
  "hasEngagements",
];

const updateData = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Strip system-managed / read-only fields before any update
    const payload = { ...req.body };
    CONTACT_READONLY_FIELDS.forEach((field) => delete payload[field]);

    // 1️⃣ Try to find in Contact Collection
    let existingContact = await Contact.findById(id);

    if (existingContact) {
      // Create history: compare changed fields
      const changedFieldNames = Object.keys(payload).filter(
        (key) =>
          String(existingContact[key] ?? "") !== String(payload[key] ?? "")
      );

      if (changedFieldNames.length > 0) {
        await ContactHistory.create({
          contact_id: existingContact._id,
          snapshot: existingContact.toObject(),
          updatedFields: changedFieldNames,
          changedFields: changedFieldNames.map((field) => ({
            field,
            oldValue: existingContact[field] ?? "",
            newValue: payload[field] ?? "",
          })),
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

      // Invalidate dropdown cache if geo or job fields changed
      const CONTACT_DROPDOWN_FIELDS = [
        "Contact_Country", "Contact_Region", "Contact_State", "Contact_City",
        "Job_Function", "Job_Seniority",
      ];
      if (changedFieldNames.some((f) => CONTACT_DROPDOWN_FIELDS.includes(f))) {
        cacheInvalidatePattern("dropdown:*");
      }

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
      const changedFieldNames = Object.keys(payload).filter(
        (key) =>
          String(existingCompany[key] ?? "") !== String(payload[key] ?? "")
      );

      if (changedFieldNames.length > 0) {
        await CompanyHistory.create({
          company_id: existingCompany._id,
          snapshot: existingCompany.toObject(),
          updatedFields: changedFieldNames,
          changedFields: changedFieldNames.map((field) => ({
            field,
            oldValue: existingCompany[field] ?? "",
            newValue: payload[field] ?? "",
          })),
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

      // Invalidate dropdown cache if company dropdown fields changed
      const COMPANY_DROPDOWN_FIELDS = [
        "Industry", "Sub_Industry", "Company_Segment",
        "Employees_Range", "Turnover_Range",
      ];
      if (changedFieldNames.some((f) => COMPANY_DROPDOWN_FIELDS.includes(f))) {
        cacheInvalidatePattern("dropdown:*");
      }

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

const getDropdownFiltersOld = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.query;

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

    // Fetch applied filters for the campaign if campaignId is provided
    let appliedFilters = [];
    let appliedExclusions = [];
    if (campaignId) {
      const latestFilter = await CampaignFilter.findOne(
        { campaignId, dataType: "Client" },
        { filters: 1, exclusions: 1 }
      )
        .sort({ revisionNo: -1 })
        .lean();

      if (latestFilter) {
        appliedFilters = latestFilter.filters || [];
        appliedExclusions = latestFilter.exclusions || [];
      }
    }

    return sendResponse(res, 200, "Unique filters fetched successfully", {
      ...companyData,
      ...contactData,
      appliedFilters,
      appliedExclusions,
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to fetch filters", 500);
  }
});

// ─── Dynamic Dropdown Filters ────────────────────────────────────────────────
// Hierarchies:
//   Country → Region → State → City
//   Industry → Sub Industry
//   Job Function → Job Seniority
//
// Query params (all optional, accept comma-separated or repeated array keys):
//   campaignId, country, region, state, industry, jobFunction
const getDropdownFilters = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    // Normalise a query param to an array (handles string, array, undefined)
    const toArray = (val) => {
      if (!val) return null;
      const arr = Array.isArray(val)
        ? val
        : val.split(",").map((s) => s.trim());
      return arr.filter(Boolean).length ? arr.filter(Boolean) : null;
    };

    const selectedCountries = toArray(req.query.country);
    const selectedRegions = toArray(req.query.region);
    const selectedStates = toArray(req.query.state);
    const selectedIndustries = toArray(req.query.industry);
    const selectedJobFunctions = toArray(req.query.jobFunction);

    const BLANK_FILTER = { $nin: [null, "", "Blank"] };

    // Helper: distinct values from the Contact collection with a given match
    const distinctContactValues = async (matchStage, field) => {
      const results = await Contact.aggregate([
        { $match: matchStage },
        { $group: { _id: `$${field}` } },
        { $match: { _id: { $nin: [null, "", "Blank"] } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, value: "$_id" } },
      ]);
      return results.map((r) => r.value);
    };

    // Helper: distinct values from the Company collection with a given match
    const distinctCompanyValues = async (matchStage, field) => {
      const results = await Company.aggregate([
        { $match: matchStage },
        { $group: { _id: `$${field}` } },
        { $match: { _id: { $nin: [null, "", "Blank"] } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, value: "$_id" } },
      ]);
      return results.map((r) => r.value);
    };

    // ── Geo match stages ─────────────────────────────────────────────────────
    const countryMatchStage = { Contact_Country: BLANK_FILTER };
    const regionMatchStage = {
      Contact_Region: BLANK_FILTER,
      ...(selectedCountries
        ? { Contact_Country: { $in: selectedCountries } }
        : {}),
    };
    const stateMatchStage = {
      Contact_State: BLANK_FILTER,
      ...(selectedCountries
        ? { Contact_Country: { $in: selectedCountries } }
        : {}),
      ...(selectedRegions ? { Contact_Region: { $in: selectedRegions } } : {}),
    };
    const cityMatchStage = {
      Contact_City: BLANK_FILTER,
      ...(selectedCountries
        ? { Contact_Country: { $in: selectedCountries } }
        : {}),
      ...(selectedRegions ? { Contact_Region: { $in: selectedRegions } } : {}),
      ...(selectedStates ? { Contact_State: { $in: selectedStates } } : {}),
    };

    // ── Industry / Sub Industry match stages ─────────────────────────────────
    // Industries are always unfiltered (parent selector)
    const industryMatchStage = { Industry: BLANK_FILTER };
    // Sub industries filtered by selected industries
    const subIndustryMatchStage = {
      Sub_Industry: BLANK_FILTER,
      ...(selectedIndustries ? { Industry: { $in: selectedIndustries } } : {}),
    };

    // ── Job Function / Job Seniority match stages ────────────────────────────
    // Job functions are always unfiltered (parent selector)
    const jobFunctionMatchStage = { Job_Function: BLANK_FILTER };
    // Job seniorities filtered by selected job functions
    const jobSeniorityMatchStage = {
      Job_Seniority: BLANK_FILTER,
      ...(selectedJobFunctions
        ? { Job_Function: { $in: selectedJobFunctions } }
        : {}),
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

    // ── Cache key: built from all cascading query params (not campaignId) ─────
    const cacheKey = `dropdown:${JSON.stringify({
      country: selectedCountries,
      region: selectedRegions,
      state: selectedStates,
      industry: selectedIndustries,
      jobFunction: selectedJobFunctions,
    })}`;

    // ── Try Redis cache first ─────────────────────────────────────────────────
    let dropdownData = await cacheGet(cacheKey);

    if (!dropdownData) {
      // ── Cache miss — run all queries in parallel ────────────────────────────
      const [
        staticCompanyFilters,
        countries,
        regions,
        states,
        cities,
        industries,
        subIndustries,
        jobFunctions,
        jobSeniorities,
      ] = await Promise.all([
        // Static company fields (segments, employeeRanges, turnovers — no parent filter)
        Company.aggregate([
          {
            $group: {
              _id: null,
              segments: { $addToSet: "$Company_Segment" },
              employeeRanges: { $addToSet: "$Employees_Range" },
              turnovers: { $addToSet: "$Turnover_Range" },
            },
          },
          {
            $project: {
              _id: 0,
              segments: {
                $filter: {
                  input: "$segments",
                  as: "v",
                  cond: {
                    $and: [
                      { $ne: ["$$v", null] },
                      { $ne: ["$$v", ""] },
                      { $ne: ["$$v", "Blank"] },
                    ],
                  },
                },
              },
              employeeRanges: {
                $filter: {
                  input: "$employeeRanges",
                  as: "v",
                  cond: {
                    $and: [
                      { $ne: ["$$v", null] },
                      { $ne: ["$$v", ""] },
                      { $ne: ["$$v", "Blank"] },
                    ],
                  },
                },
              },
              turnovers: {
                $filter: {
                  input: "$turnovers",
                  as: "v",
                  cond: {
                    $and: [
                      { $ne: ["$$v", null] },
                      { $ne: ["$$v", ""] },
                      { $ne: ["$$v", "Blank"] },
                    ],
                  },
                },
              },
            },
          },
        ]),
        // Geo
        distinctContactValues(countryMatchStage, "Contact_Country"),
        distinctContactValues(regionMatchStage, "Contact_Region"),
        distinctContactValues(stateMatchStage, "Contact_State"),
        distinctContactValues(cityMatchStage, "Contact_City"),
        // Industry hierarchy
        distinctCompanyValues(industryMatchStage, "Industry"),
        distinctCompanyValues(subIndustryMatchStage, "Sub_Industry"),
        // Job hierarchy
        distinctContactValues(jobFunctionMatchStage, "Job_Function"),
        distinctContactValues(jobSeniorityMatchStage, "Job_Seniority"),
      ]);

      const sd = staticCompanyFilters[0] || { segments: [], employeeRanges: [], turnovers: [] };
      sd.turnovers = sd.turnovers.sort((a, b) => parseRange(a) - parseRange(b));
      sd.employeeRanges = sd.employeeRanges.sort((a, b) => parseRange(a) - parseRange(b));
      sd.segments = sd.segments.sort();

      dropdownData = {
        ...sd,
        industries,
        subIndustries,
        jobFunctions,
        jobSeniorities,
        countries,
        regions,
        states,
        cities,
        genders: ["Male", "Female"],
      };

      // Cache for 2 hours — invalidated when new batch is uploaded to masterDB
      await cacheSet(cacheKey, dropdownData, 2 * 60 * 60);
    }

    // Fetch applied filters fresh — changes when user saves filters for a campaign
    let appliedFilters = [];
    let appliedExclusions = [];
    if (campaignId) {
      const latestFilter = await CampaignFilter.findOne(
        { campaignId, dataType: "Client" },
        { filters: 1, exclusions: 1 }
      )
        .sort({ revisionNo: -1 })
        .lean();

      if (latestFilter) {
        appliedFilters = latestFilter.filters || [];
        appliedExclusions = latestFilter.exclusions || [];
      }
    }

    return sendResponse(res, 200, "Dynamic filters fetched successfully", {
      ...dropdownData,
      appliedFilters,
      appliedExclusions,
    });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to fetch dynamic filters",
      500
    );
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
                templateDetails: callingData.emailTemplates.templateDetails,
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
                templateDetails: callingData.emailTemplates.templateDetails,
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
          (eng) => eng.emailHistory?.templateName
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
        const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
              ? engagements.filter((eng) => eng.emailHistory?.templateName)
                  .length
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
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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

    if (city) contactQuery.Contact_City = { $regex: city, $options: "i" };
    if (state) contactQuery.Contact_State = { $regex: state, $options: "i" };
    if (country)
      contactQuery.Contact_Country = { $regex: country, $options: "i" };

    // Pre-fetch company IDs for industry filter so pagination is accurate
    if (industry && industry.trim()) {
      const matchingCompanies = await Company.find(
        { Industry: { $regex: industry.trim(), $options: "i" } },
        { _id: 1 }
      )
        .lean()
        .exec();
      contactQuery.Company_ID = {
        $in: matchingCompanies.map((c) => c._id),
      };
    }

    const sortObj = {};
    sortObj[sortBy] = sortOrder === "asc" ? 1 : -1;

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

    // Batch fetch all engagements for this page in ONE query
    const contactIds = contacts.map((c) => c.Contact_ID).filter(Boolean);
    const engagementQuery = { contact_id: { $in: contactIds } };
    if (campaignId && campaignId.trim()) {
      engagementQuery.campaignId = campaignId.trim();
    }
    if (
      isRegistered !== undefined &&
      isRegistered !== null &&
      isRegistered !== ""
    ) {
      engagementQuery.isRegistered =
        isRegistered === "true" || isRegistered === true;
    }

    const allEngagements = await EngagementHistory.find(engagementQuery)
      .sort({ updatedAt: -1, createdAt: -1, last_engagement_date: -1 })
      .lean()
      .exec();

    // Batch fetch all CallingData for enrichment in ONE query
    const allCallingDataIds = allEngagements
      .map((eng) => eng.callingDataId)
      .filter(Boolean);

    const callingDataMap = {};
    if (allCallingDataIds.length > 0) {
      const callingDocs = await CallingData.find(
        { _id: { $in: allCallingDataIds } },
        { emailTemplates: 1, whatsappTemplates: 1 }
      ).lean();
      callingDocs.forEach((doc) => {
        callingDataMap[doc._id.toString()] = doc;
      });
    }

    // Group engagements by contact_id for O(1) lookup
    const engagementsByContactId = {};
    allEngagements.forEach((eng) => {
      const cid = eng.contact_id;
      if (!engagementsByContactId[cid]) engagementsByContactId[cid] = [];
      engagementsByContactId[cid].push(eng);
    });

    // Enrich and compute stats in-memory — no per-contact DB calls
    const contactsWithEngagements = contacts.map((contact) => {
      try {
        let engagements = engagementsByContactId[contact.Contact_ID] || [];

        if (engagements.length > 0) {
          engagements = engagements.map((eng) => {
            const doc = callingDataMap[String(eng.callingDataId)];
            if (!doc) return eng;
            const enriched = { ...eng };
            if (doc.emailTemplates?.templateName) {
              enriched.emailHistory = {
                templateId: doc.emailTemplates.templateId,
                templateName: doc.emailTemplates.templateName,
                timestamp: doc.emailTemplates.timestamp,
                status: doc.emailTemplates.status,
                messageId: doc.emailTemplates.messageId,
                templateDetails: doc.emailTemplates.templateDetails,
                history: doc.emailTemplates.history || [],
              };
            }
            if (doc.whatsappTemplates?.length > 0) {
              enriched.whatsappChatHistory = doc.whatsappTemplates.map((t) => ({
                waMessageId: t.waMessageId,
                templateId: t.templateId,
                templateName: t.templateName,
                timestamp: t.timestamp,
                status: t.status,
                failureReason: t.failureReason,
                templateDetails: t.templateDetails,
                history: t.history || [],
              }));
            }
            return enriched;
          });
        }

        const totalEngagements = engagements.length;
        const hasEngagements = totalEngagements > 0;
        const isRegisteredInAnyCampaign = engagements.some(
          (eng) => eng.isRegistered === true
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
          engagements.length > 0
            ? engagements[0].last_engagement_date ||
              engagements[0].updatedAt ||
              engagements[0].createdAt
            : null;
        const totalTelecallingRemarks = engagements.reduce(
          (sum, eng) => sum + (eng.telecalling_remarks?.length || 0),
          0
        );
        const totalWhatsappMessages = engagements.reduce(
          (sum, eng) => sum + (eng.whatsappChatHistory?.length || 0),
          0
        );
        const totalEmailsSent = engagements.filter(
          (eng) => eng.emailHistory?.templateName
        ).length;

        return {
          ...contact,
          engagements,
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
          `Error processing engagements for contact ${contact.Contact_ID}:`,
          engagementError
        );
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
    });

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

const mergeCompanies = asyncHandler(async (req, res, next) => {
  try {
    const { parentCompanyId, companyIdsToMerge } = req.body;

    if (!parentCompanyId)
      return sendError(next, "Parent company ID is required", 400);
    if (!Array.isArray(companyIdsToMerge) || companyIdsToMerge.length === 0)
      return sendError(next, "Select at least one company to merge", 400);

    // Prevent merging a company into itself
    const filteredIds = companyIdsToMerge.filter(
      (id) => id.toString() !== parentCompanyId.toString()
    );
    if (filteredIds.length === 0)
      return sendError(next, "Cannot merge a company into itself", 400);

    const parentCompany = await Company.findById(parentCompanyId).lean();
    if (!parentCompany) return sendError(next, "Parent company not found", 404);

    // Fetch full company data (snapshot) before deletion for revert capability
    const mergedCompaniesSnapshot = await Company.find({
      _id: { $in: filteredIds },
    }).lean();

    if (!mergedCompaniesSnapshot.length)
      return sendError(next, "No valid companies found to merge", 404);

    const mergedIds = mergedCompaniesSnapshot.map((c) => c._id);
    const mergedCompanies = mergedCompaniesSnapshot.map((c) => ({
      id: c._id,
      name: c.Company_Name,
    }));

    // Capture contact IDs before relinking (needed for revert)
    const contactsToRelink = await Contact.find(
      { Company_ID: { $in: mergedIds } },
      { _id: 1 }
    ).lean();
    const relinkedContactIds = contactsToRelink.map((c) => c._id);

    // Re-link all contacts from merged companies → parent company
    const updateResult = await Contact.updateMany(
      { Company_ID: { $in: mergedIds } },
      { $set: { Company_ID: parentCompanyId } }
    );

    // Delete the merged (duplicate) companies
    await Company.deleteMany({ _id: { $in: mergedIds } });

    // Save merge record with full backup for future revert
    const user = req.user;
    await CompanyMerge.create({
      parentCompany: { id: parentCompanyId, name: parentCompany.Company_Name },
      mergedCompanies,
      mergedCompaniesSnapshot,
      relinkedContactIds,
      contactsRelinked: updateResult.modifiedCount,
      mergedBy: user
        ? {
            id: user._id,
            name: user.name,
            employeeName: user.employeeName,
            email: user.email,
            role: user.role,
          }
        : undefined,
    });

    return sendResponse(res, 200, "Companies merged successfully", {
      contactsRelinked: updateResult.modifiedCount,
      companiesMerged: mergedCompanies.length,
    });
  } catch (err) {
    return sendError(next, err.message || "Merge failed", 500);
  }
});

/**
 * GET /api/masterdb/individualSearch
 * Search Contact by name, designation (Job_Title), and/or company name.
 * All provided fields are ANDed; each uses a case-insensitive regex.
 */
async function individualSearch(req, res, next) {
  try {
    const {
      name,
      designation,
      company,
      email,
      page = 1,
      limit = 20,
    } = req.query;

    if (!name && !designation && !company && !email) {
      return sendError(next, "At least one search field is required", 400);
    }

    const andConditions = [];

    const esc = (s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (name?.trim()) {
      const r = new RegExp(esc(name), "i");
      andConditions.push({
        $or: [{ Full_Name: r }, { First_Name: r }, { Last_Name: r }],
      });
    }

    if (designation?.trim()) {
      andConditions.push({ Job_Title: new RegExp(esc(designation), "i") });
    }

    if (email?.trim()) {
      const r = new RegExp(esc(email), "i");
      andConditions.push({
        $or: [
          { Office_Email_1: r },
          { Office_Email_2: r },
          { Personal_Email1: r },
          { Personal_Email2: r },
        ],
      });
    }

    // Company is on the same secondary connection — resolve IDs first, then filter Contact
    if (company?.trim()) {
      const matchingCompanies = await Company.find(
        { Company_Name: new RegExp(esc(company), "i") },
        { _id: 1 }
      ).lean();
      if (!matchingCompanies.length) {
        return sendResponse(res, 200, "No contacts found", {
          contacts: [],
          total: 0,
        });
      }
      andConditions.push({
        Company_ID: { $in: matchingCompanies.map((c) => c._id) },
      });
    }

    const query =
      andConditions.length > 1 ? { $and: andConditions } : andConditions[0];
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [rawContacts, total] = await Promise.all([
      Contact.find(query)
        .populate(
          "Company_ID",
          "Company_Name Industry Company_Segment Employees_Range Turnover_Range Website Company_ID_Kestone Company_Source Company_Phone1 Company_Phone2 Year_Founded Sub_Industry Company_LinkedIn_Profile"
        )
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Contact.countDocuments(query),
    ]);

    const maskEmail = (email) => {
      if (!email) return "";
      const [local, domain] = email.split("@");
      if (!domain) return email;
      return `${local.slice(0, 2)}${"*".repeat(
        Math.max(4, local.length - 2)
      )}@${domain}`;
    };

    const maskPhone = (phone) => {
      if (!phone) return "";
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 4) return phone;
      return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
    };

    const contacts = rawContacts.map((c) => ({
      ...c,
      Office_Email_1: maskEmail(c.Office_Email_1),
      Office_Email_2: maskEmail(c.Office_Email_2),
      Personal_Email1: maskEmail(c.Personal_Email1),
      Personal_Email2: maskEmail(c.Personal_Email2),
      Mobile_No: maskPhone(c.Mobile_No),
      Contact_Direct_Phone1: maskPhone(c.Contact_Direct_Phone1),
      Contact_Direct_Phone2: maskPhone(c.Contact_Direct_Phone2),
    }));

    return sendResponse(res, 200, "Search results", {
      contacts,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    return sendError(next, err.message || "Search failed", 500);
  }
}

/**
 * POST /api/masterdb/assignIndividualSearch
 * Assign selected contacts (by Contact._id) directly to a campaign as CallingData.
 * Batch logic: reuse the batch if any record with dataSourceType "individualSearchKestone"
 * was added to this campaign within the last 3 hours; otherwise create a new sequential batch.
 */
async function assignIndividualSearch(req, res, next) {
  try {
    const { contactIds, campaignId } = req.body;
    if (!contactIds?.length || !campaignId) {
      return sendError(next, "contactIds and campaignId are required", 400);
    }

    // 1. Validate campaign (primary DB)
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    // 2. Determine batch label
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const recentEntry = await CallingData.findOne({
      CampaignId: new mongoose.Types.ObjectId(campaignId),
      dataSourceType: "IndividualSearchKestone",
      createdAt: { $gte: threeHoursAgo },
    })
      .sort({ createdAt: -1 })
      .select("batch")
      .lean();

    let batchLabel;
    if (recentEntry?.batch) {
      batchLabel = recentEntry.batch;
    } else {
      // Pick next sequential batch number across all batches in this campaign
      const existingBatches = await CallingData.distinct("batch", {
        CampaignId: new mongoose.Types.ObjectId(campaignId),
      });
      let maxNum = 0;
      for (const b of existingBatches) {
        const m = String(b || "").match(/Batch-(\d+)/i);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
      batchLabel = `Batch-${maxNum + 1}`;
    }

    // 3. Fetch contacts from secondary DB with company details
    const validIds = contactIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const contacts = await Contact.find({ _id: { $in: validIds } })
      .populate(
        "Company_ID",
        "Company_Name Company_ID_Kestone Company_Source Year_Founded Turnover_Range Employees_Range Industry Sub_Industry Company_Segment Website Company_LinkedIn_Profile Company_Phone1 Company_Phone2"
      )
      .lean();

    // 4. Dedup — skip contacts already assigned to this campaign
    const contactIdStrings = contacts.map((c) => c.Contact_ID).filter(Boolean);
    const alreadyIn = new Set(
      (
        await CallingData.find(
          {
            CampaignId: new mongoose.Types.ObjectId(campaignId),
            Contact_ID: { $in: contactIdStrings },
          },
          { Contact_ID: 1 }
        ).lean()
      ).map((c) => c.Contact_ID)
    );

    const newContacts = contacts.filter((c) => !alreadyIn.has(c.Contact_ID));
    const duplicates = contacts.length - newContacts.length;

    if (!newContacts.length) {
      return sendResponse(
        res,
        200,
        "All selected contacts are already assigned to this campaign",
        {
          inserted: 0,
          duplicates,
          batch: batchLabel,
          isWarning: true,
        }
      );
    }

    // 5. Map Contact → CallingData
    const entries = newContacts.map((c) => ({
      CampaignId: new mongoose.Types.ObjectId(campaignId),
      UploadedBy: req.user._id,
      source: "Individual Search",
      batch: batchLabel,
      dataSourceType: "IndividualSearchKestone",
      Contact_ID: c.Contact_ID,
      Contact_Source: c.Contact_Source,
      Contact_Create_Date: c.Contact_Create_Date,
      Salutation: c.Salutation,
      First_Name: c.First_Name,
      Last_Name: c.Last_Name,
      Full_Name: c.Full_Name,
      Gender: c.Gender,
      Job_Title: c.Job_Title,
      Job_Seniority: c.Job_Seniority,
      Job_Function: c.Job_Function,
      Contact_Address_1: c.Contact_Address_1,
      Contact_Address_2: c.Contact_Address_2,
      Contact_Address_3: c.Contact_Address_3,
      Contact_City: c.Contact_City,
      Contact_Pin: c.Contact_Pin,
      Contact_State: c.Contact_State,
      Contact_Region: c.Contact_Region,
      Contact_Country: c.Contact_Country,
      Contact_STD_ISD_Code: c.Contact_STD_ISD_Code,
      Contact_Location_Tier: c.Contact_Location_Tier,
      Contact_Direct_Phone1: c.Contact_Direct_Phone1,
      Contact_Direct_Phone2: c.Contact_Direct_Phone2,
      Contact_Extn_No: c.Contact_Extn_No,
      Mobile_No: c.Mobile_No,
      Office_Email_1: c.Office_Email_1,
      Office_Email_2: c.Office_Email_2,
      Personal_Email1: c.Personal_Email1,
      Personal_Email2: c.Personal_Email2,
      Contact_LinkedIn_Profile: c.Contact_LinkedIn_Profile,
      Unsubscribe_Flag: c.Unsubscribe_Flag,
      Unsubscribe_Account_Tag: c.Unsubscribe_Account_Tag,
      DND_Flag: c.DND_Flag,
      DND_Account_Tag: c.DND_Account_Tag,
      Last_Engagement: c.Last_Engagement,
      Last_Engagement_Date: c.Last_Engagement_Date,
      Last_Engagement_Campaign: c.Last_Engagement_Campaign,
      Telecalling_Remarks: c.Telecalling_Remarks,
      EngagementPoints: c.EngagementPoints,
      Company_ID: c.Company_ID?._id || null,
      Company_Name: c.Company_ID?.Company_Name || "",
      Company_ID_Kestone: c.Company_ID?.Company_ID_Kestone || "",
      Company_Source: c.Company_ID?.Company_Source || "",
      Year_Founded: c.Company_ID?.Year_Founded || "",
      Turnover_Range: c.Company_ID?.Turnover_Range || "",
      Employees_Range: c.Company_ID?.Employees_Range || "",
      Industry: c.Company_ID?.Industry || "",
      Sub_Industry: c.Company_ID?.Sub_Industry || "",
      Company_Segment: c.Company_ID?.Company_Segment || "",
      Website: c.Company_ID?.Website || "",
      Company_LinkedIn_Profile: c.Company_ID?.Company_LinkedIn_Profile || "",
      Company_Phone1: c.Company_ID?.Company_Phone1 || "",
      Company_Phone2: c.Company_ID?.Company_Phone2 || "",
    }));

    // 6. Insert in chunks of 500
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const result = await CallingData.insertMany(entries.slice(i, i + CHUNK), {
        ordered: false,
      });
      inserted += result.length;
    }

    // 7. Mark campaign as having calling data assigned
    await Campaign.findByIdAndUpdate(campaignId, {
      isCallingDataAssigned: true,
    });

    return sendResponse(
      res,
      200,
      "Contacts assigned to campaign successfully",
      {
        inserted,
        duplicates,
        batch: batchLabel,
        campaignName: campaign.name,
      }
    );
  } catch (err) {
    return sendError(next, err.message || "Assignment failed", 500);
  }
}

export {
  batchCreateFromExcel,
  getBatchJobStatus,
  getAllData,
  getAllCompanyData,
  updateData,
  createANewCompany,
  getAllCompanyName,
  getDropdownFiltersOld,
  getDropdownFilters,
  getFiltersStats,
  updateCompany,
  getCompanyDataById,
  dumpAllHistoryData,
  migrateToEngagementHistory,
  getContactsWithEngagements,
  mergeCompanies,
  individualSearch,
  assignIndividualSearch,
};
