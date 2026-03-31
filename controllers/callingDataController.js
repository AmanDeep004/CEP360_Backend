import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import CallingDataEditApproval from "../models/callingDataEditApprovalModel.js";
import { UserRoleEnum } from "../utils/enum.js";
import XLSX from "xlsx";
import mongoose from "mongoose";
import escapeStringRegexp from "escape-string-regexp";
import { maskPhone, maskEmail } from "../utils/mobileEmailMasking.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
const {
  ADMIN,
  PRESALES_MANAGER,
  PROGRAM_MANAGER,
  RESOURCE_MANAGER,
  AGENT,
  DATABASE_MANAGER,
} = UserRoleEnum;

/**
 * @desc Upload campaign database (Excel)
 * @route POST /api/callingData/upload-database
 * @access Private
 */
const uploadcallingData = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId, UploadedBy } = req.body;
    if (!req.file) return sendError(next, "No file uploaded", 400);

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!json.length) {
      return sendError(next, "Uploaded file is empty or invalid", 400);
    }

    const REQUIRED_FIELDS = [
      "Full_Name",
      "Job_Title",
      "Contact_City",
      "Mobile_No1",
      "Company_Name",
      "Source",
    ];
    const sheetHeaders = Object.keys(json[0] || {}).map((h) =>
      h.trim().toLowerCase()
    );
    const missingFields = REQUIRED_FIELDS.filter(
      (field) => !sheetHeaders.includes(field.toLowerCase())
    );

    if (missingFields.length > 0) {
      return sendError(
        next,
        `Missing columns in sheet: ${missingFields.join(", ")}`,
        400
      );
    }

    const dbEntries = json.map((row) => ({
      CampaignId,
      UploadedBy,
      Contact_ID: row.Contact_ID || "",
      Contact_Source: row.Contact_Source || "",
      Contact_Create_Date: row.Contact_Create_Date || "",
      Salutation: row.Salutation || "",
      First_Name: row.First_Name || "",
      Last_Name: row.Last_Name || "",
      Full_Name: row.Full_Name || "",
      Gender: row.Gender || "",
      Job_Title: row.Job_Title || "",
      Job_Seniority: row.Job_Seniority || "",
      Job_Function: row.Job_Function || "",
      Contact_Address_1: row.Contact_Address_1 || "",
      Contact_Address_2: row.Contact_Address_2 || "",
      Contact_Address_3: row.Contact_Address_3 || "",
      Contact_City: row.Contact_City || "",
      Contact_Pin: row.Contact_Pin || "",
      Contact_State: row.Contact_State || "",
      Contact_Region: row.Contact_Region || "",
      Contact_Country: row.Contact_Country || "",
      Contact_STD_ISD_Code: row.Contact_STD_ISD_Code || "",
      Contact_Location_Tier: row.Contact_Location_Tier || "",
      Contact_Direct_Phone1: row.Contact_Direct_Phone1 || "",
      Contact_Direct_Phone2: row.Contact_Direct_Phone2 || "",
      Contact_Extn_No: row.Contact_Extn_No || "",
      Mobile_No: row.Mobile_No || "",
      Office_Email_1: row.Office_Email_1 || "",
      Office_Email_2: row.Office_Email_2 || "",
      Personal_Email1: row.Personal_Email1 || "",
      Personal_Email2: row.Personal_Email2 || "",
      Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile || "",
      Unsubscribe_Flag: row.Unsubscribe_Flag || "",
      Unsubscribe_Account_Tag: row.Unsubscribe_Account_Tag || "",
      DND_Flag: row.DND_Flag || "",
      DND_Account_Tag: row.DND_Account_Tag || "",
      Company_ID_Kestone: row.Company_ID_Kestone || "",
      Affinity_ID_Dell: row.Affinity_ID_Dell || "",
      Company_ID_Google: row.Company_ID_Google || "",
      Company_Source: row.Company_Source || "",
      Company_Name: row.Company_Name || "",
      Year_Founded: row.Year_Founded || "",
      Turnover_Range: row.Turnover_Range || "",
      Employees_Range: row.Employees_Range || "",
      Industry: row.Industry || "",
      Sub_Industry: row.Sub_Industry || "",
      Company_Segment: row.Company_Segment || "",
      Website: row.Website || "",
      Company_LinkedIn_Profile: row.Company_LinkedIn_Profile || "",
      Company_Phone1: row.Company_Phone1 || "",
      Company_Phone2: row.Company_Phone2 || "",
      Last_Engagement: row.Last_Engagement || "",
      Last_Engagement_Date: row.Last_Engagement_Date || "",
      Last_Engagement_Campaign: row.Last_Engagement_Campaign || "",
      Telecalling_Remarks: row.Telecalling_Remarks || "",
      source: row.Source || "",
      batch: row.Batch || "",
      pmId: row.pmId || null,
      pmName: row.pmName || "",
      agentId: row.agentId || null,
      isRegistered: row.isRegistered || false,
      registeredOn: row.registeredOn || null,
      callHistory: row.callHistory || null,
      dataSourceType: row.dataSourceType || "Kestone",
      isDataSourceApproved: row.isDataSourceApproved || false,
    }));

    if (!dbEntries.length) {
      return sendError(next, "No valid rows found in uploaded sheet", 400);
    }

    await CallingData.insertMany(dbEntries);

    return sendResponse(res, 200, "Database uploaded successfully", {
      count: dbEntries.length,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const getCallingDataById = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await CallingData.findById(id)
      .populate({ path: "CampaignId" })
      .populate({
        path: "agentId",
        select: "employeeName email",
      })
      .populate({
        path: "callHistory",
        populate: {
          path: "chatHistory",
          model: "CallHistory",
        },
      })
      .lean();
    if (!data) {
      return sendError(next, "Entry not found", 404);
    }
    return sendResponse(res, 200, "Data fetched successfully", data);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * @desc Edit a campaign database entry
 * @route PUT /api/callingData/:ids
 * @access Private
 */

const editcallingData = asyncHandler(async (req, res, next) => {
  try {
    const { _id, ...updateFields } = req.body;
    const existingEntry = await CallingData.findById(_id).lean();
    if (!existingEntry) {
      return sendError(next, "Entry not found", 404);
    }

    const changedFields = [];
    Object.keys(updateFields).forEach((key) => {
      if (existingEntry[key] !== updateFields[key]) {
        changedFields.push({
          field: key,
          oldValue: existingEntry[key],
          newValue: updateFields[key],
        });
      }
    });

    if (changedFields.length === 0) {
      return sendError(next, "No changes detected", 400);
    }

    await CallingDataEditApproval.create({
      callingDataId: _id,
      contact_Id: existingEntry.Contact_ID,
      requestedBy: req.user?._id,
      changedFields,
      status: "Pending",
      requestedAt: new Date(),
    });

    return sendResponse(res, 200, "Edit request submitted for approval", {
      callingDataId: _id,
      changedFields,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * @desc Delete a campaign database entry
 * @route DELETE /api/callingData/:id
 * @access Private
 */
const deletecallingData = asyncHandler(async (req, res, next) => {
  try {
    const deletedEntry = await CallingData.findByIdAndDelete(req.params.id);
    if (!deletedEntry) {
      return sendError(next, "Entry not found", 404);
    }
    return sendResponse(res, 200, "Entry deleted successfully", deletedEntry);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * @desc Get all calling data entries for a campaign
 * @route GET /api/callingData/campaign/:CampaignId
 * @access Private
 */

const getAllCallingDataWithoutMasking = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId, "discrepencyInData.status": { $ne: true } };

    // search on multiple fields
    if (req.query.search && req.query.search.trim() !== "") {
      const search = req.query.search.trim();
      const regex = new RegExp(escapeStringRegexp(search), "i");

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

    // filter registered
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

    // fetch data and count
    const [total, data] = await Promise.all([
      CallingData.countDocuments(filter),
      CallingData.find(filter).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, "Database fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
// here
const getAllCallingData = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId, "discrepencyInData.status": { $ne: true } };

    // search on multiple fields
    if (req.query.search && req.query.search.trim() !== "") {
      const search = req.query.search.trim();
      const regex = new RegExp(escapeStringRegexp(search), "i");

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

    // filter registered
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

    // fetch data and count
    const [total, data] = await Promise.all([
      CallingData.countDocuments(filter),
      CallingData.find(filter).skip(skip).limit(limit).lean(),
    ]);

    const maskedData = data.map((row) => ({
      ...row,

      Contact_Direct_Phone1: maskPhone(row.Contact_Direct_Phone1),
      Contact_Direct_Phone2: maskPhone(row.Contact_Direct_Phone2),
      Mobile_No: maskPhone(row.Mobile_No),

      Office_Email_1: maskEmail(row.Office_Email_1),
      Office_Email_2: maskEmail(row.Office_Email_2),
      Personal_Email1: maskEmail(row.Personal_Email1),
      Personal_Email2: maskEmail(row.Personal_Email2),
    }));

    // console.log("Masked data:", maskedData);
    return sendResponse(res, 200, "Database fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: maskedData,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getDatabaseByAssignmentold = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const { assignment } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

    if (assignment === "assigned") {
      filter.agentId = { $ne: null };
    } else if (assignment === "notassigned") {
      filter.agentId = null;
    }

    const [total, data] = await Promise.all([
      CallingData.countDocuments(filter),
      CallingData.find(filter)
        .populate("agentId", "employeeName email")
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Filtered database fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getDatabaseByAssignmentUnmasked = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const {
      assignment,
      agentId,
      remark,
      source,
      range,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limNum;

    const filter = { CampaignId, "discrepencyInData.status": { $ne: true } };

    if (assignment === "assigned") filter.agentId = { $ne: null };
    if (assignment === "notassigned") filter.agentId = null;

    if (agentId) filter.agentId = agentId;

    if (source) {
      filter.source = { $regex: source, $options: "i" };
    }

    // Validate range early before hitting the DB
    let rangeMin, rangeMax;
    if (range) {
      const parts = range.split("-").map((v) => parseInt(v.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
        return sendError(next, "Invalid range format. Use 100-200", 400);
      }
      [rangeMin, rangeMax] = parts;
      if (rangeMin > rangeMax) {
        return sendError(next, "Range minimum should be less than maximum", 400);
      }
    }

    const baseQuery = CallingData.find(filter)
      .populate({
        path: "agentId",
        select: "employeeName email",
      })
      .populate({
        path: "callHistory",
        populate: { path: "chatHistory", model: "CallHistory" },
      })
      .lean();

    // Fast path: no in-memory filtering needed — push skip/limit to DB
    if (!remark && !range) {
      const [data, total] = await Promise.all([
        baseQuery.skip(skip).limit(limNum),
        CallingData.countDocuments(filter),
      ]);

      return sendResponse(res, 200, "Filtered database fetched successfully", {
        total,
        page: pageNum,
        limit: limNum,
        totalPages: Math.ceil(total / limNum),
        data,
      });
    }

    // In-memory filtering path (remark or range requires full fetch)
    let data = await baseQuery;

    if (remark) {
      if (remark === "Yet to Call") {
        data = data.filter((entry) => {
          const history = entry.callHistory?.chatHistory;
          return !history || history.length === 0;
        });
      } else {
        data = data.filter((entry) => {
          const history = entry.callHistory?.chatHistory;
          if (!Array.isArray(history) || history.length === 0) return false;
          const lastRemark = history[history.length - 1];
          return lastRemark?.remarks === remark;
        });
      }
    }

    if (range) {
      data = data.slice(rangeMin - 1, rangeMax);
    }

    const total = data.length;
    const paginatedData = data.slice(skip, skip + limNum);

    return sendResponse(res, 200, "Filtered database fetched successfully", {
      total,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(total / limNum),
      data: paginatedData,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getDatabaseByAssignment = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const {
      assignment,
      agentId,
      remark,
      source,
      range,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limNum;

    const filter = { CampaignId, "discrepencyInData.status": { $ne: true } };

    if (assignment === "assigned") filter.agentId = { $ne: null };
    if (assignment === "notassigned") filter.agentId = null;

    if (agentId) filter.agentId = agentId;

    if (source) {
      filter.source = { $regex: new RegExp(escapeStringRegexp(source), "i") };
    }

    const applyMask = (row) => ({
      ...row,
      Contact_Direct_Phone1: maskPhone(row.Contact_Direct_Phone1),
      Contact_Direct_Phone2: maskPhone(row.Contact_Direct_Phone2),
      Mobile_No: maskPhone(row.Mobile_No),
      Office_Email_1: maskEmail(row.Office_Email_1),
      Office_Email_2: maskEmail(row.Office_Email_2),
      Personal_Email1: maskEmail(row.Personal_Email1),
      Personal_Email2: maskEmail(row.Personal_Email2),
    });

    // ── FAST PATH: no remark, no range ──────────────────────────────────────
    // Uses index { CampaignId, agentId } — pagination done at DB level
    if (!remark && !range) {
      const [docs, total] = await Promise.all([
        CallingData.find(filter)
          .populate({ path: "agentId", select: "employeeName email" })
          .populate({ path: "callHistory" })
          .skip(skip)
          .limit(limNum)
          .lean(),
        CallingData.countDocuments(filter),
      ]);

      return sendResponse(res, 200, "Filtered database fetched successfully", {
        total,
        page: pageNum,
        limit: limNum,
        totalPages: Math.ceil(total / limNum),
        data: docs.map(applyMask),
      });
    }

    // ── SLOW PATH: remark or range filter needs full dataset ─────────────────
    // chatHistory is embedded in CallHistory — nested populate removed (was a no-op)
    let data = await CallingData.find(filter)
      .populate({ path: "agentId", select: "employeeName email" })
      .populate({ path: "callHistory" })
      .lean();

    if (remark) {
      if (remark === "Yet to Call") {
        data = data.filter((entry) => {
          const history = entry.callHistory?.chatHistory;
          return !history || history.length === 0;
        });
      } else {
        data = data.filter((entry) => {
          const history = entry.callHistory?.chatHistory;
          if (!Array.isArray(history) || history.length === 0) return false;
          const lastRemark = history[history.length - 1];
          return lastRemark?.remarks === remark;
        });
      }
    }

    if (range) {
      const parts = range.split("-").map((v) => parseInt(v.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
        return sendError(next, "Invalid range format. Use 100-200", 400);
      }

      const [min, max] = parts;
      if (min > max) {
        return sendError(
          next,
          "Range minimum should be less than maximum",
          400
        );
      }

      data = data.slice(min - 1, max);
    }

    const total = data.length;
    const paginatedData = data.slice(skip, skip + limNum);

    return sendResponse(res, 200, "Filtered database fetched successfully", {
      total,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(total / limNum),
      data: paginatedData.map(applyMask),
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const assignCallingDataToAgents = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, callingDataIds, pmId, pmName } = req.body;
    const { range } = req.query;

    if (!agentId || !pmId || !pmName) {
      return sendError(
        next,
        "AgentId, ProjectManager Id, and ProjectManager Name are required",
        400
      );
    }

    let finalCallingDataIds = [];

    if (range) {
      const match = range.match(/^(\d+)-(\d+)$/);
      if (!match) {
        return sendError(
          next,
          "Invalid range format. Use 'start-end' (e.g., 1-10)",
          400
        );
      }

      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);

      if (start < 1 || end < start) {
        return sendError(
          next,
          "Invalid range. Start must be >= 1 and end must be >= start",
          400
        );
      }

      const unassignedData = await CallingData.find(
        { agentId: { $exists: false }, "discrepencyInData.status": { $ne: true } },
        { _id: 1 }
      )
        .sort({ createdAt: 1 })
        .lean();
      // Apply range slicing (convert to 0-based indexing)
      const rangeRecords = unassignedData.slice(start - 1, end);
      finalCallingDataIds = rangeRecords.map((item) => item._id.toString());

      if (!unassignedData) {
        return sendError(
          next,
          `No unassigned data found in range ${start}-${end}`,
          404
        );
      }
    }
    // Handle direct ID assignment (old method)
    else if (callingDataIds && Array.isArray(callingDataIds)) {
      if (callingDataIds.length === 0) {
        return sendError(next, "CallingDataIds array cannot be empty", 400);
      }
      finalCallingDataIds = callingDataIds;
    }
    // Neither range nor callingDataIds provided
    else {
      return sendError(
        next,
        "Either 'range' query parameter or 'callingDataIds' in body is required",
        400
      );
    }

    const result = await CallingData.updateMany(
      { _id: { $in: finalCallingDataIds } },
      { $set: { agentId, pmId, pmName } }
    );

    return sendResponse(
      res,
      200,
      `Successfully assigned ${result.modifiedCount} calling data record(s) to agent`,
      {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        agentId,
        pmId,
        pmName,
        method: range ? "range" : "direct",
      }
    );
  } catch (err) {
    console.error("Error in assignCallingDataToAgents:", err);
    return sendError(next, err.message, 500);
  }
});
const unassignCallingDataFromAgents = asyncHandler(async (req, res, next) => {
  try {
    const { callingDataIds } = req.body;

    if (!Array.isArray(callingDataIds) || callingDataIds.length === 0) {
      return sendError(next, "callingDataIds are required", 400);
    }

    const result = await CallingData.updateMany(
      { _id: { $in: callingDataIds } },
      { $unset: { agentId: "", pmId: "", pmName: "" } }
    );

    return sendResponse(
      res,
      200,
      `${result.modifiedCount} calling data records unassigned successfully`,
      result
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const reassignCallingDatatoAgents = asyncHandler(async (req, res, next) => {
  try {
    const { callingDataIds, newAgentId } = req.body;

    if (
      !Array.isArray(callingDataIds) ||
      callingDataIds.length === 0 ||
      !newAgentId
    ) {
      return sendError(
        next,
        "CallingData Ids and New AgentId are required",
        400
      );
    }

    const records = await CallingData.find(
      { _id: { $in: callingDataIds } },
      { agentId: 1 } // fetch only agentId field
    );

    if (records.length === 0) {
      return sendError(
        next,
        "No records found for provided callingDataIds",
        404
      );
    }

    const bulkOps = records.map((rec) => ({
      updateOne: {
        filter: { _id: rec._id },
        update: {
          $set: {
            agentId: newAgentId,
            "reassigned_to.status": true,
          },
          $push: {
            "reassigned_to.previously_assigned_to": {
              agentId: rec.agentId,
              unassignedAt: new Date(),
            },
          },
        },
      },
    }));

    const result = await CallingData.bulkWrite(bulkOps);

    return sendResponse(
      res,
      200,
      `${result.modifiedCount} records reassigned successfully`,
      result
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const CALLING_DATA_ALLOWED_FIELDS = [
  "Salutation", "First_Name", "Last_Name", "Full_Name", "Gender",
  "Job_Title", "Job_Seniority", "Job_Function",
  "Contact_Address_1", "Contact_Address_2", "Contact_Address_3",
  "Contact_City", "Contact_Pin", "Contact_State", "Contact_Region", "Contact_Country",
  "Contact_STD_ISD_Code", "Contact_Location_Tier",
  "Contact_Direct_Phone1", "Contact_Direct_Phone2", "Contact_Extn_No", "Mobile_No",
  "Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2",
  "Contact_LinkedIn_Profile", "Telecalling_Remarks",
  "Company_Name", "Turnover_Range", "Employees_Range", "Industry", "Sub_Industry",
  "Company_Segment", "Website", "Company_LinkedIn_Profile",
  "Company_Phone1", "Company_Phone2",
  "source", "batch", "dataSourceType",
];

const UpdateCallingData = asyncHandler(async (req, res, next) => {
  try {
    const { _id, ...updateFields } = req.body;
    if (!_id) {
      return sendError(next, "_id is required for update", 400);
    }

    const safeUpdate = {};
    CALLING_DATA_ALLOWED_FIELDS.forEach((field) => {
      if (updateFields[field] !== undefined) safeUpdate[field] = updateFields[field];
    });

    const updatedData = await CallingData.findByIdAndUpdate(_id, {
      $set: safeUpdate,
    }).lean();

    if (!updatedData) {
      return sendError(next, "Entry not found", 404);
    }

    return sendResponse(
      res,
      200,
      "Calling data updated successfully",
      updatedData
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/* ── PRIORITY FEATURE ── */

const setPriority = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { priorityDate, note } = req.body;

    if (!priorityDate) {
      return sendError(next, "priorityDate is required", 400);
    }

    const updated = await CallingData.findByIdAndUpdate(
      id,
      {
        $set: {
          "priority.isActive": true,
          "priority.priorityDate": new Date(priorityDate),
          "priority.setAt": new Date(),
          "priority.note": note || "",
        },
      },
      { new: true }
    ).lean();

    if (!updated) return sendError(next, "Record not found", 404);

    return sendResponse(res, 200, "Priority set successfully", updated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getPriorityList = asyncHandler(async (req, res, next) => {
  try {
    const { agentId } = req.params;

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const priorities = await CallingData.find({
      agentId: new mongoose.Types.ObjectId(agentId),
      "priority.isActive": true,
      "priority.priorityDate": { $lte: endOfDay },
    })
      .select(
        "Full_Name Company_Name Contact_Direct_Phone1 Mobile_No Job_Title priority CampaignId isRegistered"
      )
      .sort({ "priority.setAt": 1 })
      .lean();

    return sendResponse(res, 200, "Priority list fetched", priorities);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const closePriority = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;

    const updated = await CallingData.findByIdAndUpdate(
      id,
      { $set: { "priority.isActive": false } },
      { new: true }
    ).lean();

    if (!updated) return sendError(next, "Record not found", 404);

    return sendResponse(res, 200, "Priority closed", updated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export {
  uploadcallingData,
  getCallingDataById,
  editcallingData,
  deletecallingData,
  getAllCallingData,
  getDatabaseByAssignment,
  assignCallingDataToAgents,
  unassignCallingDataFromAgents,
  reassignCallingDatatoAgents,
  UpdateCallingData,
  getDatabaseByAssignmentUnmasked,
  setPriority,
  getPriorityList,
  closePriority,
};
