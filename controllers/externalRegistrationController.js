import ExternalRegistration from "../models/externalRegistrationModel.js";
import errorHandler from "../utils/index.js";
import { UserRoleEnum } from "../utils/enum.js";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import CallingData from "../models/callingDataModal.js";

const { ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT } = UserRoleEnum;
const { asyncHandler, sendError, sendResponse } = errorHandler;

// Required fields for upload validation
const REQUIRED_FIELDS = [
  "Full_Name",
  "Job_Title",
  "Contact_City",
  "Mobile_No",
  "Office_Email_1",
  "Company_Name",
  "Registration_Status",
  "Registration_Date",
  "Is_Attended",
];

// All template columns (in order)
const TEMPLATE_COLUMNS = [
  "Salutation", "First_Name", "Last_Name", "Full_Name", "Gender",
  "Job_Title", "Job_Seniority", "Job_Seniority_Secondary", "Job_Seniority_Tertiary", "Job_Function",
  "Contact_Address_1", "Contact_Address_2", "Contact_Address_3",
  "Contact_City", "Contact_Pin", "Contact_State", "Contact_Region",
  "Contact_Country", "Contact_STD_ISD_Code", "Contact_Location_Tier",
  "Contact_Direct_Phone1", "Contact_Direct_Phone2", "Contact_Extn_No",
  "Mobile_No", "Office_Email_1", "Office_Email_2",
  "Personal_Email1", "Personal_Email2", "Contact_LinkedIn_Profile",
  "Company_Name", "Affinity_ID_Dell", "Company_ID_Google",
  "Year_Founded", "Turnover_Range", "Employees_Range",
  "Industry", "Sub_Industry", "Company_Segment",
  "Website", "Company_LinkedIn_Profile", "Company_Phone1", "Company_Phone2",
  "Registration_Status", "Registration_Date", "Is_Attended",
];

const MONTH_MAP = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,
  september:8,october:9,november:10,december:11,
};

/**
 * Parse a date value from Excel — handles all common formats:
 * XLSX serial number, ISO YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
 * DD-MMM-YYYY, MMM DD YYYY, etc.
 */
const parseFlexDate = (v) => {
  if (!v) return new Date();

  // XLSX serial date number
  if (typeof v === "number") {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return new Date(d.y, d.m - 1, d.d);
    } catch { /* fall through */ }
    return new Date();
  }

  const s = String(v).trim();

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);

  // DD-MMM-YYYY or DD MMM YYYY (e.g. 09-Jul-2025 or 09 Jul 2025)
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (m) {
    const mo = MONTH_MAP[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(+m[3], mo, +m[1]);
  }

  // MMM DD, YYYY or MMM DD YYYY (e.g. Jul 09, 2025)
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})$/);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo !== undefined) return new Date(+m[3], mo, +m[2]);
  }

  // Native parse fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
};

//upload external registration data
const uploadExternalDataControllerOld = asyncHandler(async (req, res, next) => {
  try {
    // Check if file exists
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // Get CampaignId from request (adjust based on your route structure)
    const { CampaignId } = req.body; // or req.params or req.query

    if (!CampaignId) {
      return sendError(next, "CampaignId is required", 400);
    }

    // Read Excel file
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    if (!excelData || excelData.length === 0) {
      return sendError(next, "Excel file is empty", 400);
    }

    const results = {
      total: excelData.length,
      matched: 0,
      notMatched: 0,
      inserted: 0,
      errors: [],
    };

    // Process each row
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];

      try {
        // Extract mobile and email fields from Excel
        const mobileNo = row.Mobile_No?.toString().trim();
        const contact_Direct_Phone1 =
          row.Contact_Direct_Phone1?.toString().trim();
        const contact_Direct_Phone2 =
          row.Contact_Direct_Phone2?.toString().trim();
        const officeEmail1 = row.Office_Email_1?.toString()
          .trim()
          .toLowerCase();
        const officeEmail2 = row.Office_Email_2?.toString()
          .trim()
          .toLowerCase();
        const personalEmail1 = row.Personal_Email1?.toString()
          .trim()
          .toLowerCase();
        const personalEmail2 = row.Personal_Email2?.toString()
          .trim()
          .toLowerCase();

        // Build OR conditions for matching
        const orConditions = [];

        // Add mobile number conditions
        if (mobileNo) {
          orConditions.push({ Mobile_No: mobileNo });
        }
        if (contact_Direct_Phone1) {
          orConditions.push({ Contact_Direct_Phone1: contact_Direct_Phone1 });
        }
        if (contact_Direct_Phone2) {
          orConditions.push({ Contact_Direct_Phone2: contact_Direct_Phone2 });
        }

        // Add email conditions
        if (officeEmail1) {
          orConditions.push({ Office_Email_1: officeEmail1 });
        }
        if (officeEmail2) {
          orConditions.push({ Office_Email_2: officeEmail2 });
        }
        if (personalEmail1) {
          orConditions.push({ Personal_Email1: personalEmail1 });
        }
        if (personalEmail2) {
          orConditions.push({ Personal_Email2: personalEmail2 });
        }

        // Skip if no valid contact info
        if (orConditions.length === 0) {
          results.errors.push({
            row: i + 1,
            message: "No mobile or email found",
            data: row,
          });
          continue;
        }

        // Build final query: CampaignId AND (mobile OR email)
        const matchQuery = {
          CampaignId: CampaignId,
          $or: orConditions,
        };

        // Check if exists in CallingData
        const existingCallingData = await CallingData.findOne(matchQuery);

        let isRegistered = false;
        let isAvailableInCallingData = false;

        // If match found in CallingData
        if (existingCallingData) {
          isRegistered = true;
          isAvailableInCallingData = true;
          results.matched++;

          // Update CallingData registration status with proper registrationSource
          await CallingData.findByIdAndUpdate(
            existingCallingData._id,
            {
              isRegistered: true,
              registeredOn: new Date(),
              registrationSource: "External Registration",
            },
            { new: true } // Return updated document
          );
          console.log(
            `✓ Matched and updated CallingData ID: ${existingCallingData._id}`
          );
        } else {
          results.notMatched++;
          console.log(`✗ No match found for row ${i + 1}`);
        }

        // Prepare ExternalRegistration document
        const registrationData = {
          Contact_Source: row.Contact_Source || "External Upload",
          Salutation: row.Salutation,
          First_Name: row.First_Name,
          Last_Name: row.Last_Name,
          Full_Name: row.Full_Name,
          Gender: row.Gender,
          Job_Title: row.Job_Title,
          Job_Seniority: row.Job_Seniority,
          Job_Seniority_Secondary: row.Job_Seniority_Secondary,
          Job_Seniority_Tertiary: row.Job_Seniority_Tertiary,
          Job_Function: row.Job_Function,
          Contact_Address_1: row.Contact_Address_1,
          Contact_Address_2: row.Contact_Address_2,
          Contact_Address_3: row.Contact_Address_3,
          Contact_City: row.Contact_City,
          Contact_Pin: row.Contact_Pin,
          Contact_State: row.Contact_State,
          Contact_Region: row.Contact_Region,
          Contact_Country: row.Contact_Country,
          Contact_STD_ISD_Code: row.Contact_STD_ISD_Code,
          Contact_Location_Tier: row.Contact_Location_Tier,
          Contact_Direct_Phone1: contact_Direct_Phone1,
          Contact_Direct_Phone2: contact_Direct_Phone2,
          Contact_Extn_No: row.Contact_Extn_No,
          Mobile_No: mobileNo,
          Office_Email_1: officeEmail1,
          Office_Email_2: officeEmail2,
          Personal_Email1: personalEmail1,
          Personal_Email2: personalEmail2,
          Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile,
          Unsubscribe_Flag: row.Unsubscribe_Flag,
          Unsubscribe_Account_Tag: row.Unsubscribe_Account_Tag,
          DND_Flag: row.DND_Flag,
          DND_Account_Tag: row.DND_Account_Tag,
          Last_Engagement: row.Last_Engagement,
          Last_Engagement_Date: row.Last_Engagement_Date,
          Last_Engagement_Campaign: row.Last_Engagement_Campaign,
          Telecalling_Remarks: row.Telecalling_Remarks,
          Company_Name: row.Company_Name,
          Company_ID_Kestone: row.Company_ID_Kestone,
          Affinity_ID_Dell: row.Affinity_ID_Dell,
          Company_ID_Google: row.Company_ID_Google,
          Company_Source: row.Company_Source,
          Year_Founded: row.Year_Founded,
          Turnover_Range: row.Turnover_Range,
          Employees_Range: row.Employees_Range,
          Industry: row.Industry,
          Sub_Industry: row.Sub_Industry,
          Company_Segment: row.Company_Segment,
          Website: row.Website,
          Company_LinkedIn_Profile: row.Company_LinkedIn_Profile,
          Company_Phone1: row.Company_Phone1,
          Company_Phone2: row.Company_Phone2,
          isRegistered,
          isAvailableInCallingData,
          registeredOn: isRegistered ? new Date() : null,
        };

        // Insert into ExternalRegistration
        const data = await ExternalRegistration.create(registrationData);
        console.log(`✓ Inserted ExternalRegistration ID: ${data._id}`);
        results.inserted++;
      } catch (error) {
        console.error(`✗ Error processing row ${i + 1}:`, error.message);
        results.errors.push({
          row: i + 1,
          message: error.message,
          data: row,
        });
      }
    }

    return sendResponse(
      res,
      200,
      "External registration data processed successfully",
      results
    );
  } catch (error) {
    console.error("Controller error:", error);
    return sendError(next, error.message, 500);
  }
});

const uploadExternalDataController = asyncHandler(async (req, res, next) => {
  try {
    // Check if file exists
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // Get CampaignId from request
    const { CampaignId } = req.body;

    if (!CampaignId || !mongoose.isValidObjectId(CampaignId)) {
      return sendError(next, "Valid CampaignId is required", 400);
    }

    // Read Excel file — always Sheet 1 only; skip any sheet named "Sample*"
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const uploadSheet = workbook.SheetNames.find(
      (n) => !n.toLowerCase().startsWith("sample")
    );
    if (!uploadSheet) return sendError(next, "No uploadable sheet found in file", 400);
    const worksheet = workbook.Sheets[uploadSheet];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    // Filter out ghost/empty rows — must have at least one phone number
    const excelData = rawData.filter((row) =>
      [row.Mobile_No, row.Contact_Direct_Phone1, row.Contact_Direct_Phone2]
        .some((v) => String(v ?? "").trim() !== "")
    );

    if (!excelData || excelData.length === 0) {
      return sendError(next, "Excel file is empty or has no valid rows", 400);
    }

    const results = {
      total: excelData.length,
      matched: 0,
      notMatched: 0,
      inserted: 0,
      updated: 0,
      withinFileDuplicates: [], // { row, Full_Name, Mobile_No, phone }
      skipped: [],              // { row, Full_Name, Mobile_No, message }
      errors: [],               // { row, Full_Name, Mobile_No, message }
    };

    // ── Pre-parse all rows and collect phone numbers ───────────────────────
    const allMobiles = [];
    const allPhone1s = [];
    const allPhone2s = [];

    const parsedRows = excelData.map((row, i) => {
      const mobileNo              = row.Mobile_No?.toString().trim()                    || "";
      const contact_Direct_Phone1 = row.Contact_Direct_Phone1?.toString().trim()        || "";
      const contact_Direct_Phone2 = row.Contact_Direct_Phone2?.toString().trim()        || "";
      const officeEmail1          = row.Office_Email_1?.toString().trim().toLowerCase() || "";
      const officeEmail2          = row.Office_Email_2?.toString().trim().toLowerCase() || "";
      const personalEmail1        = row.Personal_Email1?.toString().trim().toLowerCase() || "";
      const personalEmail2        = row.Personal_Email2?.toString().trim().toLowerCase() || "";

      if (mobileNo)              allMobiles.push(mobileNo);
      if (contact_Direct_Phone1) allPhone1s.push(contact_Direct_Phone1);
      if (contact_Direct_Phone2) allPhone2s.push(contact_Direct_Phone2);

      return { row, i, mobileNo, contact_Direct_Phone1, contact_Direct_Phone2,
               officeEmail1, officeEmail2, personalEmail1, personalEmail2 };
    });

    // ── Bulk-fetch existing records with 2 queries instead of N×6 ─────────
    const phoneOrConditions = [];
    if (allMobiles.length)  phoneOrConditions.push({ Mobile_No:             { $in: [...new Set(allMobiles)] } });
    if (allPhone1s.length)  phoneOrConditions.push({ Contact_Direct_Phone1: { $in: [...new Set(allPhone1s)] } });
    if (allPhone2s.length)  phoneOrConditions.push({ Contact_Direct_Phone2: { $in: [...new Set(allPhone2s)] } });

    const phoneProject = { _id: 1, Mobile_No: 1, Contact_Direct_Phone1: 1, Contact_Direct_Phone2: 1 };
    const [existingCallingDocs, existingExtDocs] = await Promise.all([
      phoneOrConditions.length
        ? CallingData.find({ CampaignId, $or: phoneOrConditions }, phoneProject).lean()
        : Promise.resolve([]),
      phoneOrConditions.length
        ? ExternalRegistration.find({ CampaignId, $or: phoneOrConditions }, phoneProject).lean()
        : Promise.resolve([]),
    ]);

    // Build in-memory lookup maps: phone → doc
    const cdByMobile  = new Map();
    const cdByPhone1  = new Map();
    const cdByPhone2  = new Map();
    for (const doc of existingCallingDocs) {
      if (doc.Mobile_No)             cdByMobile.set(doc.Mobile_No, doc);
      if (doc.Contact_Direct_Phone1) cdByPhone1.set(doc.Contact_Direct_Phone1, doc);
      if (doc.Contact_Direct_Phone2) cdByPhone2.set(doc.Contact_Direct_Phone2, doc);
    }

    const extByMobile = new Map();
    const extByPhone1 = new Map();
    const extByPhone2 = new Map();
    for (const doc of existingExtDocs) {
      if (doc.Mobile_No)             extByMobile.set(doc.Mobile_No, doc);
      if (doc.Contact_Direct_Phone1) extByPhone1.set(doc.Contact_Direct_Phone1, doc);
      if (doc.Contact_Direct_Phone2) extByPhone2.set(doc.Contact_Direct_Phone2, doc);
    }

    // ── Build bulk operation lists (no DB calls in loop) ──────────────────
    const callingDataBulkOps = [];
    const extRegInserts      = [];

    for (const { row, i, mobileNo, contact_Direct_Phone1, contact_Direct_Phone2,
                 officeEmail1, officeEmail2, personalEmail1, personalEmail2 } of parsedRows) {

      const hasPhone = mobileNo || contact_Direct_Phone1 || contact_Direct_Phone2;
      if (!hasPhone) {
        results.errors.push({ row: i + 2, Full_Name: String(row.Full_Name || ""), Mobile_No: "", message: "No mobile or phone number found" });
        continue;
      }

      const missingFields = REQUIRED_FIELDS.filter((f) => {
        const val = row[f];
        return val === undefined || val === null || String(val).trim() === "";
      });
      if (missingFields.length > 0) {
        results.skipped.push({ row: i + 2, Full_Name: String(row.Full_Name || ""), Mobile_No: mobileNo, message: `Missing: ${missingFields.join(", ")}` });
        continue;
      }

      const regBool      = ["true", "t", "yes", "y", "1"].includes(String(row.Registration_Status || "").trim().toLowerCase());
      const attendedBool = ["true", "t", "yes", "y", "1"].includes(String(row.Is_Attended || "").trim().toLowerCase());
      const regDate      = parseFlexDate(row.Registration_Date);

      // Match CallingData via lookup map (mobile → phone1 → phone2 priority)
      const existingCallingData =
        (mobileNo              && cdByMobile.get(mobileNo)) ||
        (contact_Direct_Phone1 && cdByPhone1.get(contact_Direct_Phone1)) ||
        (contact_Direct_Phone2 && cdByPhone2.get(contact_Direct_Phone2)) ||
        null;

      // If the phone was seen earlier IN THIS SAME FILE (tracked as "local"),
      // skip the row — a real insert/update is already queued for that phone.
      // Previously this was pushed as updateOne({ _id: "local" }) which is a
      // silent no-op in MongoDB (the string never matches an ObjectId), causing
      // these rows to vanish without any count.
      if (existingCallingData?._id === "local") {
        results.withinFileDuplicates.push({
          row: i + 2,
          Full_Name: String(row.Full_Name || ""),
          Mobile_No: mobileNo,
          phone: mobileNo || contact_Direct_Phone1 || contact_Direct_Phone2,
        });
        continue;
      }

      let isAvailableInCallingData = false;

      if (existingCallingData) {
        isAvailableInCallingData = true;
        results.matched++;
        callingDataBulkOps.push({
          updateOne: {
            filter: { _id: existingCallingData._id },
            update: { $set: {
              isRegistered:       regBool,
              registeredOn:       regDate,
              registrationSource: "External Registration",
              isAttended:         attendedBool,
            } },
          },
        });
      } else {
        results.notMatched++;
        callingDataBulkOps.push({
          insertOne: {
            document: {
              CampaignId,
              UploadedBy:               req.user._id,
              Contact_Source:           row.Contact_Source || "External Registration",
              Salutation:               row.Salutation               || "",
              First_Name:               row.First_Name               || "",
              Last_Name:                row.Last_Name                || "",
              Full_Name:                row.Full_Name                || "",
              Gender:                   row.Gender                   || "",
              Job_Title:                row.Job_Title                || "",
              Job_Seniority:            row.Job_Seniority            || "",
              Job_Seniority_Secondary:  row.Job_Seniority_Secondary  || "",
              Job_Seniority_Tertiary:   row.Job_Seniority_Tertiary   || "",
              Job_Function:             row.Job_Function             || "",
              Contact_Address_1:        row.Contact_Address_1        || "",
              Contact_Address_2:        row.Contact_Address_2        || "",
              Contact_Address_3:        row.Contact_Address_3        || "",
              Contact_City:             row.Contact_City             || "",
              Contact_Pin:              String(row.Contact_Pin       || ""),
              Contact_State:            row.Contact_State            || "",
              Contact_Region:           row.Contact_Region           || "",
              Contact_Country:          row.Contact_Country          || "",
              Contact_STD_ISD_Code:     String(row.Contact_STD_ISD_Code || ""),
              Contact_Location_Tier:    row.Contact_Location_Tier    || "",
              Contact_Direct_Phone1:    String(contact_Direct_Phone1 || ""),
              Contact_Direct_Phone2:    String(contact_Direct_Phone2 || ""),
              Contact_Extn_No:          String(row.Contact_Extn_No   || ""),
              Mobile_No:                String(mobileNo              || ""),
              Office_Email_1:           officeEmail1                 || "",
              Office_Email_2:           officeEmail2                 || "",
              Personal_Email1:          personalEmail1               || "",
              Personal_Email2:          personalEmail2               || "",
              Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile || "",
              Company_Name:             row.Company_Name             || "",
              Company_ID_Kestone:       row.Company_ID_Kestone       || "",
              Company_Source:           row.Company_Source           || "",
              Year_Founded:             String(row.Year_Founded      || ""),
              Turnover_Range:           row.Turnover_Range           || "",
              Employees_Range:          row.Employees_Range          || "",
              Industry:                 row.Industry                 || "",
              Sub_Industry:             row.Sub_Industry             || "",
              Company_Segment:          row.Company_Segment          || "",
              Website:                  row.Website                  || "",
              Company_LinkedIn_Profile: row.Company_LinkedIn_Profile || "",
              Company_Phone1:           String(row.Company_Phone1    || ""),
              Company_Phone2:           String(row.Company_Phone2    || ""),
              source:                   "External Registration",
              dataSourceType:           "External",
              isRegistered:             regBool,
              registeredOn:             regDate,
              registrationSource:       "External Registration",
              isAttended:               attendedBool,
            },
          },
        });
        // Track locally so duplicate phones within the same file don't double-insert
        if (mobileNo)              cdByMobile.set(mobileNo, { _id: "local" });
        if (contact_Direct_Phone1) cdByPhone1.set(contact_Direct_Phone1, { _id: "local" });
        if (contact_Direct_Phone2) cdByPhone2.set(contact_Direct_Phone2, { _id: "local" });
      }

      // ExternalRegistration — skip if phone already exists for this campaign
      const existingExtRecord =
        (mobileNo              && extByMobile.get(mobileNo)) ||
        (contact_Direct_Phone1 && extByPhone1.get(contact_Direct_Phone1)) ||
        (contact_Direct_Phone2 && extByPhone2.get(contact_Direct_Phone2)) ||
        null;

      if (existingExtRecord) {
        results.updated++;
      } else {
        extRegInserts.push({
          CampaignId,
          Contact_Source:           row.Contact_Source || "File",
          Salutation:               row.Salutation,
          First_Name:               row.First_Name,
          Last_Name:                row.Last_Name,
          Full_Name:                row.Full_Name,
          Gender:                   row.Gender,
          Job_Title:                row.Job_Title,
          Job_Seniority:            row.Job_Seniority,
          Job_Seniority_Secondary:  row.Job_Seniority_Secondary,
          Job_Seniority_Tertiary:   row.Job_Seniority_Tertiary,
          Job_Function:             row.Job_Function,
          Contact_Address_1:        row.Contact_Address_1,
          Contact_Address_2:        row.Contact_Address_2,
          Contact_Address_3:        row.Contact_Address_3,
          Contact_City:             row.Contact_City,
          Contact_Pin:              row.Contact_Pin,
          Contact_State:            row.Contact_State,
          Contact_Region:           row.Contact_Region,
          Contact_Country:          row.Contact_Country,
          Contact_STD_ISD_Code:     row.Contact_STD_ISD_Code,
          Contact_Location_Tier:    row.Contact_Location_Tier,
          Contact_Direct_Phone1:    contact_Direct_Phone1,
          Contact_Direct_Phone2:    contact_Direct_Phone2,
          Contact_Extn_No:          row.Contact_Extn_No,
          Mobile_No:                mobileNo,
          Office_Email_1:           officeEmail1,
          Office_Email_2:           officeEmail2,
          Personal_Email1:          personalEmail1,
          Personal_Email2:          personalEmail2,
          Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile,
          Company_Name:             row.Company_Name,
          Company_ID_Kestone:       row.Company_ID_Kestone,
          Affinity_ID_Dell:         row.Affinity_ID_Dell,
          Company_ID_Google:        row.Company_ID_Google,
          Company_Source:           row.Company_Source,
          Year_Founded:             row.Year_Founded,
          Turnover_Range:           row.Turnover_Range,
          Employees_Range:          row.Employees_Range,
          Industry:                 row.Industry,
          Sub_Industry:             row.Sub_Industry,
          Company_Segment:          row.Company_Segment,
          Website:                  row.Website,
          Company_LinkedIn_Profile: row.Company_LinkedIn_Profile,
          Company_Phone1:           row.Company_Phone1,
          Company_Phone2:           row.Company_Phone2,
          isRegistered:             regBool,
          isAttended:               attendedBool,
          isAvailableInCallingData,
          registeredOn:             regBool ? regDate : null,
        });
        // Track locally so re-uploads within the same file don't double-insert
        if (mobileNo)              extByMobile.set(mobileNo, { _id: "local" });
        if (contact_Direct_Phone1) extByPhone1.set(contact_Direct_Phone1, { _id: "local" });
        if (contact_Direct_Phone2) extByPhone2.set(contact_Direct_Phone2, { _id: "local" });
      }
    }

    // ── Execute bulk DB operations ─────────────────────────────────────────
    if (callingDataBulkOps.length > 0) {
      try {
        await CallingData.bulkWrite(callingDataBulkOps, { ordered: false });
      } catch (bulkErr) {
        console.error("CallingData bulkWrite error:", bulkErr.message);
        results.errors.push({ message: `CallingData bulk operation error: ${bulkErr.message}` });
      }
    }

    if (extRegInserts.length > 0) {
      try {
        await ExternalRegistration.insertMany(extRegInserts, { ordered: false });
        results.inserted = extRegInserts.length;
      } catch (insertErr) {
        console.error("ExternalRegistration insertMany error:", insertErr.message);
        results.inserted = insertErr.result?.nInserted ?? 0;
        results.errors.push({ message: `ExternalRegistration insert error: ${insertErr.message}` });
      }
    }

    return sendResponse(
      res,
      200,
      "External registration data processed successfully",
      results
    );
  } catch (error) {
    console.error("Controller error:", error);
    return sendError(next, error.message, 500);
  }
});

const getAllExternalRegistrations = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

    // Search on multiple fields
    if (req.query.search && req.query.search.trim() !== "") {
      const search = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(search, "i");

      filter.$or = [
        { Full_Name: regex },
        { First_Name: regex },
        { Last_Name: regex },
        { Mobile_No: regex },
        { Office_Email_1: regex },
        { Office_Email_2: regex },
        { Personal_Email1: regex },
        { Personal_Email2: regex },
        { Contact_Direct_Phone1: regex },
        { Contact_Direct_Phone2: regex },
        { Company_Name: regex },
      ];
    }

    // Filter by isRegistered
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

    // Filter by isAvailableInCallingData
    if (req.query.isAvailableInCallingData !== undefined) {
      const val = req.query.isAvailableInCallingData.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isAvailableInCallingData = val === "true";
      }
    }

    // Filter by Contact_Source
    if (req.query.Contact_Source) {
      filter.Contact_Source = req.query.Contact_Source;
    }

    // Fetch data and count
    const [total, data] = await Promise.all([
      ExternalRegistration.countDocuments(filter),
      ExternalRegistration.find(filter)
        .sort({ createdAt: -1 }) // Latest first
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(
      res,
      200,
      "External registrations fetched successfully",
      {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        data,
      }
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const downloadExternalRegistrationTemplate = asyncHandler(async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Registration Data");

    const YELLOW = "FFFFFF00"; // required column header
    const GREY   = "FFF2F2F2"; // optional column header

    // Build header row with styling
    ws.columns = TEMPLATE_COLUMNS.map((col) => ({ header: col, key: col, width: 24 }));

    const headerRow = ws.getRow(1);
    TEMPLATE_COLUMNS.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      const isRequired = REQUIRED_FIELDS.includes(col);
      cell.font = { bold: true, color: { argb: "FF000000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isRequired ? YELLOW : GREY } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
      };
    });
    headerRow.height = 20;

    // Sheet 1: blank data sheet (user fills this and uploads)
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Sheet 2: sample reference — NOT uploaded (upload reads SheetNames[0] only)
    const wsSample = wb.addWorksheet("Sample (Do Not Upload)");
    wsSample.columns = TEMPLATE_COLUMNS.map((col) => ({ header: col, key: col, width: 24 }));

    const sampleHdr = wsSample.getRow(1);
    TEMPLATE_COLUMNS.forEach((col, idx) => {
      const cell = sampleHdr.getCell(idx + 1);
      const isRequired = REQUIRED_FIELDS.includes(col);
      cell.font = { bold: true, color: { argb: "FF000000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isRequired ? YELLOW : GREY } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
    });
    sampleHdr.height = 20;

    const dateColIdx = TEMPLATE_COLUMNS.indexOf("Registration_Date") + 1;

    const dataRow = wsSample.addRow({
      Salutation: "Mr.", First_Name: "Amit", Last_Name: "Kumar",
      Full_Name: "Amit Kumar", Gender: "Male",
      Job_Title: "VP Engineering", Job_Seniority: "VP", Job_Function: "Engineering",
      Contact_Address_1: "Plot 12 Cyber City", Contact_Address_2: "", Contact_Address_3: "",
      Contact_City: "Gurugram", Contact_Pin: "122002", Contact_State: "Haryana",
      Contact_Region: "North", Contact_Country: "India", Contact_STD_ISD_Code: "+91",
      Contact_Location_Tier: "Tier 1", Contact_Direct_Phone1: "01244001234",
      Contact_Direct_Phone2: "", Contact_Extn_No: "201",
      Mobile_No: "9988776655", Office_Email_1: "amit.kumar@wipro.com",
      Office_Email_2: "a.kumar@wipro.net", Personal_Email1: "", Personal_Email2: "",
      Contact_LinkedIn_Profile: "",
      Company_Name: "Wipro Limited", Affinity_ID_Dell: "WIP-001", Company_ID_Google: "",
      Year_Founded: "1945", Turnover_Range: "5000-10000 Cr", Employees_Range: "10000+",
      Industry: "IT Services", Sub_Industry: "Software", Company_Segment: "Enterprise",
      Website: "www.wipro.com", Company_LinkedIn_Profile: "", Company_Phone1: "01244001000", Company_Phone2: "",
      Registration_Status: "yes", Registration_Date: new Date("2025-01-20"), Is_Attended: "yes",
    });

    dataRow.getCell(dateColIdx).numFmt = "dd-mmm-yyyy";

    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F4FD" } };
    });

    wsSample.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="external_registration_template.xlsx"');
    res.send(buf);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { uploadExternalDataController, getAllExternalRegistrations, downloadExternalRegistrationTemplate };
