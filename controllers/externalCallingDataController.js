import XLSX from "xlsx";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import CallingData from "../models/callingDataModal.js";
import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError } = errorHandler;

// Template columns — exact order from reference file
const COLUMNS = [
  "First_Name", "Last_Name", "Full_Name", "Salutation", "Gender",
  "Job_Title", "Job_Seniority", "Job_Seniority_Secondary", "Job_Seniority_Tertiary", "Job_Function",
  "Mobile_No", "Contact_Direct_Phone1", "Contact_Direct_Phone2", "Contact_Extn_No",
  "Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2",
  "Contact_City", "Contact_State", "Contact_Country", "Contact_Region", "Contact_Pin",
  "Contact_Address_1", "Contact_Address_2", "Contact_Address_3",
  "Contact_Location_Tier", "Contact_STD_ISD_Code",
  "Company_Name", "Website", "Industry", "Sub_Industry", "Company_Segment",
  "Turnover_Range", "Employees_Range", "Year_Founded",
  "Company_LinkedIn_Profile", "Company_Phone1", "Company_Phone2",
  "Company_Source", "Company_ID_Kestone",
  "Contact_LinkedIn_Profile", "Contact_Source",
];

const PHONE_FIELDS = ["Mobile_No", "Contact_Direct_Phone1", "Contact_Direct_Phone2"];
const EMAIL_FIELDS = ["Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2"];

// ── Template download ────────────────────────────────────────────────────────
const downloadExternalCallingDataTemplate = asyncHandler(async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Calling Data");

    ws.columns = COLUMNS.map((col) => ({ header: col, key: col, width: 24 }));

    const headerRow = ws.getRow(1);
    COLUMNS.forEach((_, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.font      = { bold: true, color: { argb: "FF000000" } };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
    });
    headerRow.height = 20;
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="external_calling_data_template.xlsx"');
    res.send(buf);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── Upload calling data ──────────────────────────────────────────────────────
const uploadExternalCallingData = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) return sendError(next, "No file uploaded", 400);

    const { CampaignId } = req.body;
    if (!CampaignId || !mongoose.isValidObjectId(CampaignId)) {
      return sendError(next, "Valid CampaignId is required", 400);
    }

    const campaign = await Campaign.findById(CampaignId).select("_id").lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    // Read uploaded file
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return sendError(next, "Uploaded file is empty", 400);

    // ── Collect all phones + emails from uploaded file ───────────────────────
    const allPhones = new Set();
    const allEmails = new Set();

    for (const row of rows) {
      for (const f of PHONE_FIELDS) {
        const v = String(row[f] || "").trim();
        if (v) allPhones.add(v);
      }
      for (const f of EMAIL_FIELDS) {
        const v = String(row[f] || "").trim().toLowerCase();
        if (v) allEmails.add(v);
      }
    }

    // ── Find existing CallingData in this campaign matching any phone/email ──
    const orConditions = [];
    if (allPhones.size) {
      orConditions.push(
        { Mobile_No:              { $in: [...allPhones] } },
        { Contact_Direct_Phone1:  { $in: [...allPhones] } },
        { Contact_Direct_Phone2:  { $in: [...allPhones] } }
      );
    }
    if (allEmails.size) {
      orConditions.push(
        { Office_Email_1:  { $in: [...allEmails] } },
        { Office_Email_2:  { $in: [...allEmails] } },
        { Personal_Email1: { $in: [...allEmails] } },
        { Personal_Email2: { $in: [...allEmails] } }
      );
    }

    // ── Batch label ──────────────────────────────────────────────────────────
    const existingBatches = await CallingData.distinct("batch", {
      CampaignId,
      dataSourceType: "External",
    });
    const batchNo    = existingBatches.filter(Boolean).length + 1;
    const batchLabel = `Batch-${batchNo}`;

    // existingKeys: Set of "phone:<v>" and "email:<v>" that already exist
    const existingKeys = new Set();
    if (orConditions.length) {
      const existing = await CallingData.find(
        { CampaignId, $or: orConditions },
        "Mobile_No Contact_Direct_Phone1 Contact_Direct_Phone2 Office_Email_1 Office_Email_2 Personal_Email1 Personal_Email2"
      ).lean();

      for (const doc of existing) {
        for (const f of PHONE_FIELDS) {
          const v = String(doc[f] || "").trim();
          if (v) existingKeys.add(`phone:${v}`);
        }
        for (const f of EMAIL_FIELDS) {
          const v = String(doc[f] || "").trim().toLowerCase();
          if (v) existingKeys.add(`email:${v}`);
        }
      }
    }

    // ── Classify rows ────────────────────────────────────────────────────────
    const toInsert   = [];
    const duplicates = [];

    // takenSet prevents intra-file duplicates from being inserted twice
    const takenKeys = new Set(existingKeys);

    for (const row of rows) {
      const rowPhones = PHONE_FIELDS.map((f) => String(row[f] || "").trim()).filter(Boolean);
      const rowEmails = EMAIL_FIELDS.map((f) => String(row[f] || "").trim().toLowerCase()).filter(Boolean);

      // Check if any phone or email already exists in DB or already taken in this file
      const isDuplicate =
        rowPhones.some((v) => existingKeys.has(`phone:${v}`)) ||
        rowEmails.some((v) => existingKeys.has(`email:${v}`));

      if (isDuplicate) {
        duplicates.push(row);
        continue;
      }

      // Check intra-file duplicates (only mark taken if we're actually inserting)
      const alreadyTaken =
        rowPhones.some((v) => takenKeys.has(`phone:${v}`)) ||
        rowEmails.some((v) => takenKeys.has(`email:${v}`));

      if (alreadyTaken) {
        duplicates.push({ ...row, _Note: "Intra-file duplicate" });
        continue;
      }

      // Mark as taken
      rowPhones.forEach((v) => takenKeys.add(`phone:${v}`));
      rowEmails.forEach((v) => takenKeys.add(`email:${v}`));

      toInsert.push({
        CampaignId,
        UploadedBy:               req.user._id,
        Contact_Source:           row.Contact_Source           || "",
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
        Contact_Direct_Phone1:    String(row.Contact_Direct_Phone1 || ""),
        Contact_Direct_Phone2:    String(row.Contact_Direct_Phone2 || ""),
        Contact_Extn_No:          String(row.Contact_Extn_No   || ""),
        Mobile_No:                String(row.Mobile_No         || ""),
        Office_Email_1:           String(row.Office_Email_1    || "").toLowerCase(),
        Office_Email_2:           String(row.Office_Email_2    || "").toLowerCase(),
        Personal_Email1:          String(row.Personal_Email1   || "").toLowerCase(),
        Personal_Email2:          String(row.Personal_Email2   || "").toLowerCase(),
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
        source:                   "External",
        batch:                    batchLabel,
        dataSourceType:           "External",
        isDataSourceApproved:     false,
      });
    }

    // ── Insert ───────────────────────────────────────────────────────────────
    let inserted = 0;
    let failed   = 0;

    if (toInsert.length) {
      try {
        const result = await CallingData.insertMany(toInsert, { ordered: false });
        inserted = result.length;
      } catch (bulkErr) {
        inserted = bulkErr.insertedDocs?.length ?? 0;
        failed   = toInsert.length - inserted;
      }

      if (inserted > 0) {
        await Campaign.findByIdAndUpdate(CampaignId, { isCallingDataAssigned: true });
      }
    }

    // ── Build result XLSX ─────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ["Metric",                   "Count"],
      ["Total Rows in File",        rows.length],
      ["Inserted",                  inserted],
      ["Duplicates (skipped)",      duplicates.length],
      ["Insert Failed",             failed],
      ["Batch Assigned",            batchLabel],
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    summaryWs["!cols"] = [{ wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    // Sheet 2: Duplicate rows (if any)
    if (duplicates.length > 0) {
      const dupWs = XLSX.utils.json_to_sheet(duplicates);
      dupWs["!cols"] = Object.keys(duplicates[0]).map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, dupWs, "Duplicates");
    }

    // Sheet 3: Failed rows (if any)
    if (failed > 0) {
      const failedRows = toInsert.slice(inserted);
      const failWs = XLSX.utils.json_to_sheet(failedRows);
      failWs["!cols"] = Object.keys(failedRows[0]).map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, failWs, "Failed");
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename="upload_result.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("X-Inserted-Count",   String(inserted));
    res.setHeader("X-Duplicate-Count",  String(duplicates.length));
    res.setHeader("X-Failed-Count",     String(failed));
    res.setHeader("X-Total-Count",      String(rows.length));
    res.setHeader("X-Batch-Label",      batchLabel);
    res.setHeader("Access-Control-Expose-Headers",
      "X-Inserted-Count,X-Duplicate-Count,X-Failed-Count,X-Total-Count,X-Batch-Label"
    );

    return res.send(buf);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { downloadExternalCallingDataTemplate, uploadExternalCallingData };
