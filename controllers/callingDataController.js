import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import PrioritySlot from "../models/prioritySlotModel.js";
import CallHistory from "../models/callHistoryModel.js";
import CallingDataEditApproval from "../models/callingDataEditApprovalModel.js";
import { UserRoleEnum } from "../utils/enum.js";
import XLSX from "xlsx";
import mongoose from "mongoose";
import escapeStringRegexp from "escape-string-regexp";
import { maskPhone, maskEmail } from "../utils/mobileEmailMasking.js";
import EngagementHistory from "../models/MasterDBModel/enagagementHistoryModel.js";
import { sendEmail } from "../services/microsoftGraphMailer.js";
import {
  callingDataUploadedToPMTemplate,
  callingDataAssignedToAgentTemplate,
  callingDataReassignedToAgentTemplate,
} from "../services/notificationEmailTemplates.js";
import { EmailTrigger } from "../utils/enum.js";
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
      // Affinity_ID_Dell: row.Affinity_ID_Dell || "",
      // Company_ID_Google: row.Company_ID_Google || "",
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

    // Fire-and-forget: notify campaign PM(s) about new data upload
    Campaign.findById(CampaignId)
      .populate({ path: "programManager", select: "employeeName email" })
      .lean()
      .then((campaign) => {
        if (!campaign?.programManager?.length) return;
        const uploadedByName = req.user?.employeeName || "";
        campaign.programManager.forEach((pm) => {
          if (!pm.email) return;
          sendEmail(
            pm.email,
            `New calling data added to campaign: ${campaign.name}`,
            callingDataUploadedToPMTemplate({
              pmName: pm.employeeName,
              campaignName: campaign.name,
              count: dbEntries.length,
              uploadedByName,
            }),
            {
              trigger: EmailTrigger.CALLING_DATA_UPLOADED,
              campaignId: campaign._id,
              recipientUserId: pm._id,
            }
          );
        });
      })
      .catch((err) => console.error(`[Email] Calling data upload notification failed: ${err.message}`));

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

    const [data, allHistories] = await Promise.all([
      CallingData.findById(id)
        .populate({ path: "CampaignId" })
        .populate({ path: "agentId", select: "employeeName email" })
        .lean(),
      CallHistory.find({ callingData_id: id }).lean(),
    ]);

    if (!data) return sendError(next, "Entry not found", 404);

    // Merge chatHistory from ALL CallHistory docs (across all campaigns), newest first
    const combinedChatHistory = allHistories
      .flatMap((h) => h.chatHistory || [])
      .sort((a, b) => new Date(b.callingDate) - new Date(a.callingDate));

    data.callHistory = { chatHistory: combinedChatHistory };

    // Fetch previous campaign engagements from master DB by Contact_ID
    if (data.Contact_ID) {
      data.engagementHistory = await EngagementHistory.find({ contact_id: data.Contact_ID })
        .sort({ last_engagement_date: -1, createdAt: -1 })
        .lean();
    } else {
      data.engagementHistory = [];
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

    // Immediately apply changes to CallingData without waiting for approval
    const immediateUpdate = {};
    changedFields.forEach(({ field, newValue }) => {
      immediateUpdate[field] = newValue;
    });
    await CallingData.findByIdAndUpdate(_id, { $set: immediateUpdate });

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

    // text search across name / contact / company fields
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

    // dedicated Source Type filter — exact match
    if (req.query.dataSourceType && req.query.dataSourceType.trim()) {
      filter.dataSourceType = req.query.dataSourceType.trim();
    }

    // dedicated Batch filter — case-insensitive contains
    if (req.query.batch && req.query.batch.trim()) {
      filter.batch = new RegExp(escapeStringRegexp(req.query.batch.trim()), "i");
    }

    // filter registered
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

    // priority group filter
    if (req.query.priorityGroup && req.query.priorityGroup.trim()) {
      const pg = req.query.priorityGroup.trim();
      if (pg === "unassigned") {
        filter["priorityGroup.no"] = null;
      } else {
        filter["priorityGroup.label"] = pg;
      }
    }

    // fetch data and count
    const [total, data] = await Promise.all([
      CallingData.countDocuments(filter),
      CallingData.find(filter).sort({ "priorityGroup.no": 1 }).skip(skip).limit(limit).lean(),
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
      batch,
      priorityGroup,   // "P-1","P-2",... or "unassigned"
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

    if (batch) {
      filter.batch = { $regex: new RegExp(escapeStringRegexp(batch), "i") };
    }

    if (priorityGroup === "unassigned") {
      filter["priorityGroup.no"] = null;
    } else if (priorityGroup) {
      filter["priorityGroup.label"] = priorityGroup;
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
          .sort({ "priorityGroup.no": 1 })  // P-1 first; nulls sort last in MongoDB asc
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

    // Fire-and-forget: notify the assigned agent
    if (result.modifiedCount > 0) {
      Promise.all([
        User.findById(agentId).select("employeeName email").lean(),
        // Get campaign name from one of the assigned records
        CallingData.findOne({ _id: { $in: finalCallingDataIds } })
          .populate({ path: "CampaignId", select: "name" })
          .lean(),
      ])
        .then(([agent, sampleRecord]) => {
          if (!agent?.email) return;
          sendEmail(
            agent.email,
            `Calling data assigned to you`,
            callingDataAssignedToAgentTemplate({
              agentName: agent.employeeName,
              campaignName: sampleRecord?.CampaignId?.name || "—",
              count: result.modifiedCount,
              pmName,
            }),
            {
              trigger: EmailTrigger.CALLING_DATA_ASSIGNED_TO_AGENT,
              campaignId: sampleRecord?.CampaignId?._id || null,
              recipientUserId: agent._id,
            }
          );
        })
        .catch((err) => console.error(`[Email] Calling data assignment notification failed: ${err.message}`));
    }

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

    // Fire-and-forget: notify the newly assigned agent
    if (result.modifiedCount > 0) {
      Promise.all([
        User.findById(newAgentId).select("employeeName email").lean(),
        CallingData.findOne({ _id: { $in: callingDataIds } })
          .populate({ path: "CampaignId", select: "name" })
          .lean(),
      ])
        .then(([agent, sampleRecord]) => {
          if (!agent?.email) return;
          sendEmail(
            agent.email,
            `Calling data reassigned to you`,
            callingDataReassignedToAgentTemplate({
              agentName: agent.employeeName,
              campaignName: sampleRecord?.CampaignId?.name || "—",
              count: result.modifiedCount,
            }),
            {
              trigger: EmailTrigger.CALLING_DATA_REASSIGNED_TO_AGENT,
              campaignId: sampleRecord?.CampaignId?._id || null,
              recipientUserId: agent._id,
            }
          );
        })
        .catch((err) => console.error(`[Email] Calling data reassignment notification failed: ${err.message}`));
    }

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

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY GROUP FEATURE
// ═══════════════════════════════════════════════════════════════════════════

// Filterable fields exposed to presales for building priority filter queries
const PRIORITY_FILTER_FIELDS = [
  "Contact_City",
  "Contact_State",
  "Contact_Region",
  "Contact_Country",
  "Industry",
  "Sub_Industry",
  "Company_Segment",
  "Job_Seniority",
  "Job_Function",
  "Employees_Range",
  "Turnover_Range",
  "Gender",
];

/**
 * Build a MongoDB match object from a filters map.
 * filters: { Contact_City: ["Delhi","Mumbai"], Industry: ["IT"] }
 * → { Contact_City: { $in: [...] }, Industry: { $in: [...] } }
 */
function buildPriorityMatchFromFilters(filters = {}) {
  const match = {};
  for (const [field, values] of Object.entries(filters)) {
    if (!PRIORITY_FILTER_FIELDS.includes(field)) continue;
    const arr = Array.isArray(values) ? values : [values];
    const realVals = arr.filter((v) => v && v !== "__blank__");
    const includeBlank = arr.includes("__blank__");

    if (realVals.length > 0 && includeBlank) {
      // match records that have a value in the list OR have null/empty
      match.$or = [
        ...(match.$or || []),
        { [field]: { $in: realVals } },
        { [field]: null },
        { [field]: "" },
        { [field]: { $exists: false } },
      ];
    } else if (includeBlank) {
      match.$or = [
        ...(match.$or || []),
        { [field]: null },
        { [field]: "" },
        { [field]: { $exists: false } },
      ];
    } else if (realVals.length > 0) {
      match[field] = { $in: realVals };
    }
  }
  return match;
}

/**
 * GET /callingData/:campaignId/priorityFilterOptions
 * Returns distinct values for each filterable field from this campaign's data.
 */
const priorityFilterOptions = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    const results = await Promise.all(
      PRIORITY_FILTER_FIELDS.map(async (field) => {
        const vals = await CallingData.distinct(field, { CampaignId: campaignId });
        const filled = vals.filter((v) => v && String(v).trim()).sort();
        // Check if any records have null / empty for this field
        const hasBlank = await CallingData.exists({
          CampaignId: campaignId,
          $or: [{ [field]: null }, { [field]: "" }, { [field]: { $exists: false } }],
        });
        return { field, values: hasBlank ? [...filled, "__blank__"] : filled };
      })
    );

    const options = {};
    results.forEach(({ field, values }) => { options[field] = values; });

    return sendResponse(res, 200, "Priority filter options fetched", options);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * GET /callingData/:campaignId/priorityPreview
 * Query params: filters (JSON string)
 * Returns count of records matching the given filters + overlap with already-assigned records.
 */
const priorityPreview = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    let filters = {};
    try {
      filters = req.query.filters ? JSON.parse(req.query.filters) : {};
    } catch {
      return sendError(next, "Invalid filters JSON", 400);
    }

    const fieldMatch = buildPriorityMatchFromFilters(filters);
    // If contactIds also provided for individual mode
    const contactIds = req.query.contactIds
      ? req.query.contactIds.split(",").filter(Boolean)
      : [];

    let baseQuery = { CampaignId: campaignId };

    if (contactIds.length > 0 && Object.keys(fieldMatch).length > 0) {
      // union: matches filter OR is in contactIds list
      baseQuery.$or = [
        fieldMatch,
        { _id: { $in: contactIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      ];
    } else if (contactIds.length > 0) {
      baseQuery._id = { $in: contactIds.map((id) => new mongoose.Types.ObjectId(id)) };
    } else {
      Object.assign(baseQuery, fieldMatch);
    }

    const [total, overlap] = await Promise.all([
      CallingData.countDocuments(baseQuery),
      CallingData.countDocuments({ ...baseQuery, "priorityGroup.no": { $ne: null } }),
    ]);

    return sendResponse(res, 200, "Preview count fetched", { total, overlap });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * POST /callingData/:campaignId/assignPriorityGroup
 * Body: { filters: {}, contactIds: [], overwriteExisting: false }
 * Assigns the next P-N label to matching records.
 */
const assignPriorityGroup = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    const { filters = {}, contactIds = [], overwriteExisting = false, groupNo } = req.body;

    const fieldMatch = buildPriorityMatchFromFilters(filters);
    const hasContactIds = Array.isArray(contactIds) && contactIds.length > 0;
    const hasFilters = Object.keys(fieldMatch).length > 0;

    if (!hasFilters && !hasContactIds) {
      return sendError(next, "Provide at least one filter or contactIds", 400);
    }

    // Use explicit groupNo if provided, otherwise auto-increment
    let assignedNo;
    if (groupNo && Number.isInteger(Number(groupNo)) && Number(groupNo) > 0) {
      assignedNo = Number(groupNo);
    } else {
      const maxDoc = await CallingData.findOne(
        { CampaignId: campaignId, "priorityGroup.no": { $ne: null } },
        { "priorityGroup.no": 1 }
      )
        .sort({ "priorityGroup.no": -1 })
        .lean();
      assignedNo = (maxDoc?.priorityGroup?.no ?? 0) + 1;
    }

    const nextNo = assignedNo;
    const label = `P-${nextNo}`;
    const assignedAt = new Date();

    // Build query
    let baseQuery = { CampaignId: campaignId };
    if (hasContactIds && hasFilters) {
      baseQuery.$or = [
        fieldMatch,
        { _id: { $in: contactIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      ];
    } else if (hasContactIds) {
      baseQuery._id = { $in: contactIds.map((id) => new mongoose.Types.ObjectId(id)) };
    } else {
      Object.assign(baseQuery, fieldMatch);
    }

    // Skip already-assigned records unless overwrite is requested
    if (!overwriteExisting) {
      baseQuery["priorityGroup.no"] = null;
    }

    const result = await CallingData.updateMany(baseQuery, {
      $set: {
        "priorityGroup.no":         nextNo,
        "priorityGroup.label":      label,
        "priorityGroup.assignedAt": assignedAt,
        "priorityGroup.filters":    filters,
      },
    });

    return sendResponse(res, 200, `Assigned ${label} to ${result.modifiedCount} records`, {
      label,
      no: nextNo,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * GET /callingData/:campaignId/priorityGroups
 * Returns all priority groups with record counts and filter snapshots.
 */
const getPriorityGroups = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    const [groups, unassignedCount] = await Promise.all([
      CallingData.aggregate([
        { $match: { CampaignId: campaignId, "priorityGroup.no": { $ne: null } } },
        {
          $group: {
            _id:        "$priorityGroup.no",
            label:      { $first: "$priorityGroup.label" },
            filters:    { $first: "$priorityGroup.filters" },
            assignedAt: { $first: "$priorityGroup.assignedAt" },
            count:      { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id:        0,
            no:         "$_id",
            label:      1,
            filters:    1,
            assignedAt: 1,
            count:      1,
          },
        },
      ]),
      CallingData.countDocuments({ CampaignId: campaignId, "priorityGroup.no": null }),
    ]);

    return sendResponse(res, 200, "Priority groups fetched", { groups, unassignedCount });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * DELETE /callingData/:campaignId/priorityGroup/:groupNo
 * Resets priorityGroup to null for all records in this group.
 * Does NOT re-number other groups (gaps are left intentionally).
 */
const deletePriorityGroup = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, groupNo } = req.params;
    const no = parseInt(groupNo, 10);
    if (!campaignId || isNaN(no)) return sendError(next, "campaignId and groupNo are required", 400);

    const result = await CallingData.updateMany(
      { CampaignId: campaignId, "priorityGroup.no": no },
      {
        $set: {
          "priorityGroup.no":         null,
          "priorityGroup.label":      null,
          "priorityGroup.assignedAt": null,
          "priorityGroup.filters":    null,
        },
      }
    );

    return sendResponse(res, 200, `Removed priority group P-${no}`, {
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * PATCH /callingData/:campaignId/swapPriorityGroups
 * Body: { groupNoA: 1, groupNoB: 2 }
 * Swaps the no+label of two groups without touching other fields.
 */
const swapPriorityGroups = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { groupNoA, groupNoB } = req.body;
    const noA = parseInt(groupNoA, 10);
    const noB = parseInt(groupNoB, 10);
    if (!campaignId || isNaN(noA) || isNaN(noB) || noA === noB) {
      return sendError(next, "campaignId, groupNoA and groupNoB (different) are required", 400);
    }

    // Use a temp number to avoid unique-constraint clashes during swap
    const TEMP = -1;
    await CallingData.updateMany(
      { CampaignId: campaignId, "priorityGroup.no": noA },
      { $set: { "priorityGroup.no": TEMP, "priorityGroup.label": `P-${TEMP}` } }
    );
    await CallingData.updateMany(
      { CampaignId: campaignId, "priorityGroup.no": noB },
      { $set: { "priorityGroup.no": noA, "priorityGroup.label": `P-${noA}` } }
    );
    await CallingData.updateMany(
      { CampaignId: campaignId, "priorityGroup.no": TEMP },
      { $set: { "priorityGroup.no": noB, "priorityGroup.label": `P-${noB}` } }
    );

    return sendResponse(res, 200, `Swapped P-${noA} and P-${noB}`, {});
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── Priority Slot Definitions (persisted per campaign) ─────────────────────

/**
 * GET /callingData/:campaignId/prioritySlots
 * Returns all defined slot definitions for a campaign, sorted by no asc.
 */
const getPrioritySlots = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const slots = await PrioritySlot.find({ campaignId }).sort({ no: 1 }).lean();
    return sendResponse(res, 200, "Priority slots fetched", { slots });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * POST /callingData/:campaignId/prioritySlots
 * Body: { no, label }  — creates a new slot definition.
 * Auto-increments `no` if not supplied.
 */
const createPrioritySlot = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    let { no, label } = req.body;

    if (!no) {
      const last = await PrioritySlot.findOne({ campaignId }).sort({ no: -1 }).lean();
      no = (last?.no ?? 0) + 1;
    }
    no = parseInt(no, 10);
    if (!label) label = `P-${no}`;

    const slot = await PrioritySlot.findOneAndUpdate(
      { campaignId, no },
      { campaignId, no, label },
      { upsert: true, new: true }
    );
    return sendResponse(res, 201, "Priority slot created", { slot });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * DELETE /callingData/:campaignId/prioritySlots/:no
 * Removes the slot definition AND resets any CallingData records assigned to this group.
 */
const deletePrioritySlotDef = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, no: noParam } = req.params;
    const no = parseInt(noParam, 10);
    if (isNaN(no)) return sendError(next, "Invalid slot number", 400);

    // Remove slot definition
    await PrioritySlot.deleteOne({ campaignId, no });

    // Clear CallingData records for this group
    const result = await CallingData.updateMany(
      { CampaignId: campaignId, "priorityGroup.no": no },
      {
        $set: {
          "priorityGroup.no":         null,
          "priorityGroup.label":      null,
          "priorityGroup.assignedAt": null,
          "priorityGroup.filters":    null,
        },
      }
    );

    return sendResponse(res, 200, `Deleted slot P-${no}`, { modifiedCount: result.modifiedCount });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════

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
  priorityFilterOptions,
  priorityPreview,
  assignPriorityGroup,
  getPriorityGroups,
  deletePriorityGroup,
  swapPriorityGroups,
  getPrioritySlots,
  createPrioritySlot,
  deletePrioritySlotDef,
};
