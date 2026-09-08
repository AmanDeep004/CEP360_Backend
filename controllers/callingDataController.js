import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import PrioritySlot from "../models/prioritySlotModel.js";
import CallHistory from "../models/callHistoryModel.js";
import CallingDataEditApproval from "../models/callingDataEditApprovalModel.js";
import CallingDataEditLog from "../models/callingDataEditLogModel.js";
import { UserRoleEnum, REMARK_STATUS } from "../utils/enum.js";
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
      Job_Seniority_Secondary: row.Job_Seniority_Secondary || "",
      Job_Seniority_Tertiary: row.Job_Seniority_Tertiary || "",
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

/**
 * @desc Add a single contact to a campaign (agent-initiated)
 * @route POST /api/callingData/addContact
 * @access Private
 */
const addSingleContact = asyncHandler(async (req, res, next) => {
  try {
    const {
      CampaignId, agentId, pmId, pmName, source,
      // Personal
      Salutation, First_Name, Last_Name, Full_Name, Gender,
      // Job
      Job_Title, Job_Seniority, Job_Seniority_Secondary, Job_Seniority_Tertiary, Job_Function,
      // Contact
      Mobile_No, Contact_Direct_Phone1, Contact_Direct_Phone2, Contact_Extn_No,
      Office_Email_1, Office_Email_2, Personal_Email1, Personal_Email2,
      Contact_LinkedIn_Profile,
      // Address
      Contact_Address_1, Contact_City, Contact_State, Contact_Region,
      Contact_Country, Contact_Pin, Contact_STD_ISD_Code, Contact_Location_Tier,
      // Company
      Company_Name, Industry, Sub_Industry, Company_Segment,
      Turnover_Range, Employees_Range, Website,
      Company_Phone1, Company_Phone2, Company_LinkedIn_Profile,
    } = req.body;

    if (!CampaignId) return sendError(next, "CampaignId is required", 400);
    const hasName  = Full_Name?.trim();
    const hasPhone = Mobile_No?.trim() || Contact_Direct_Phone1?.trim() || Contact_Direct_Phone2?.trim();
    if (!hasName)  return sendError(next, "Full Name is required", 400);
    if (!hasPhone) return sendError(next, "At least one phone number is required", 400);

    const str = (v) => (v?.trim() || null);

    const contact = await CallingData.create({
      CampaignId,
      UploadedBy: req.user?._id,
      agentId: agentId || null,
      pmId:    pmId    || null,
      pmName:  str(pmName),
      source:  str(source) || "Agent Added",
      // Personal
      Salutation: str(Salutation), First_Name: str(First_Name), Last_Name: str(Last_Name),
      Full_Name:  str(Full_Name),  Gender: str(Gender),
      // Job
      Job_Title: str(Job_Title), Job_Seniority: str(Job_Seniority), Job_Seniority_Secondary: str(Job_Seniority_Secondary), Job_Seniority_Tertiary: str(Job_Seniority_Tertiary), Job_Function: str(Job_Function),
      // Contact
      Mobile_No: str(Mobile_No),
      Contact_Direct_Phone1: str(Contact_Direct_Phone1), Contact_Direct_Phone2: str(Contact_Direct_Phone2),
      Contact_Extn_No: str(Contact_Extn_No),
      Office_Email_1: str(Office_Email_1), Office_Email_2: str(Office_Email_2),
      Personal_Email1: str(Personal_Email1), Personal_Email2: str(Personal_Email2),
      Contact_LinkedIn_Profile: str(Contact_LinkedIn_Profile),
      // Address
      Contact_Address_1: str(Contact_Address_1), Contact_City: str(Contact_City),
      Contact_State: str(Contact_State), Contact_Region: str(Contact_Region),
      Contact_Country: str(Contact_Country), Contact_Pin: str(Contact_Pin),
      Contact_STD_ISD_Code: str(Contact_STD_ISD_Code), Contact_Location_Tier: str(Contact_Location_Tier),
      // Company
      Company_Name: str(Company_Name), Industry: str(Industry), Sub_Industry: str(Sub_Industry),
      Company_Segment: str(Company_Segment), Turnover_Range: str(Turnover_Range),
      Employees_Range: str(Employees_Range), Website: str(Website),
      Company_Phone1: str(Company_Phone1), Company_Phone2: str(Company_Phone2),
      Company_LinkedIn_Profile: str(Company_LinkedIn_Profile),
    });

    // Audit log — fire-and-forget
    const SKIP_KEYS = new Set(["_id", "__v", "createdAt", "updatedAt", "CampaignId", "UploadedBy", "agentId", "pmId"]);
    const logFields = Object.entries(contact.toObject())
      .filter(([key, val]) => {
        if (SKIP_KEYS.has(key)) return false;
        if (val === null || val === undefined || val === "") return false;
        if (Array.isArray(val) && val.length === 0) return false;
        if (typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0) return false;
        return true;
      })
      .map(([field, newValue]) => ({ field, oldValue: null, newValue }));

    CallingDataEditLog.create({
      callingDataId:  contact._id,
      campaignId:     contact.CampaignId,
      updatedBy:      req.user?._id,
      updatedByName:  req.user?.employeeName,
      updatedByRole:  req.user?.role,
      action:         "created",
      changedFields:  logFields,
    }).catch((err) => console.error("[CallingDataEditLog] Failed to save create log:", err.message));

    return sendResponse(res, 201, "Contact added successfully", contact);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

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

    // Approval + MasterDB sync temporarily disabled
    // await CallingDataEditApproval.create({
    //   callingDataId: _id,
    //   contact_Id: existingEntry.Contact_ID,
    //   requestedBy: req.user?._id,
    //   changedFields,
    //   status: "Pending",
    //   requestedAt: new Date(),
    // });

    const immediateUpdate = {};
    changedFields.forEach(({ field, newValue }) => {
      immediateUpdate[field] = newValue;
    });
    const updated = await CallingData.findByIdAndUpdate(_id, { $set: immediateUpdate }, { new: true }).lean();

    // Audit log — fire-and-forget, never blocks the response
    CallingDataEditLog.create({
      callingDataId: _id,
      campaignId: existingEntry.CampaignId,
      updatedBy: req.user?._id,
      updatedByName: req.user?.employeeName,
      updatedByRole: req.user?.role,
      changedFields,
    }).catch((err) => console.error("[CallingDataEditLog] Failed to save log:", err.message));

    return sendResponse(res, 200, "Calling data updated successfully", {
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
    if (skip > 100_000) return sendError(next, "Page too deep. Use additional filters to narrow results.", 400);
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

    // dedicated Source Type filter
    if (req.query.dataSourceType && req.query.dataSourceType.trim()) {
      const dst = req.query.dataSourceType.trim();
      if (dst === "Kestone") {
        filter.dataSourceType = { $in: ["Kestone", "Both"] };
      } else if (dst === "Client") {
        filter.dataSourceType = { $in: ["Client", "Both"] };
      } else {
        filter.dataSourceType = dst;
      }
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

    // agent filter
    if (req.query.agentId && req.query.agentId.trim()) {
      filter.agentId = req.query.agentId.trim();
    }

    // remark filter — "Yet to Call" means never called (lastRemarks null/missing)
    const remarkFilter = req.query.remark?.trim();
    if (remarkFilter) {
      if (remarkFilter.toLowerCase() === "yet to call") {
        filter.lastRemarks = { $in: [null, "", "Yet to Call"] };
      } else {
        filter.lastRemarks = remarkFilter;
      }
    }

    // calling date range filter
    if (req.query.callingDateFrom || req.query.callingDateTo) {
      filter.lastCallingDate = {};
      if (req.query.callingDateFrom) {
        filter.lastCallingDate.$gte = new Date(req.query.callingDateFrom);
      }
      if (req.query.callingDateTo) {
        const end = new Date(req.query.callingDateTo);
        end.setHours(23, 59, 59, 999);
        filter.lastCallingDate.$lte = end;
      }
    }

    // fetch data and count
    if (skip > 100_000) return sendError(next, "Page too deep. Use additional filters to narrow results.", 400);
    const [total, data] = await Promise.all([
      CallingData.countDocuments(filter),
      CallingData.find(filter)
        .sort({ "priorityGroup.no": 1 })
        .skip(skip)
        .limit(limit)
        .populate("agentId", "employeeName employeeCode")
        .populate({
          path: "callHistory",
          populate: { path: "chatHistory.callRecordingId", select: "recording callDuration agentName" },
        })
        .lean(),
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

const getDatabaseByAssignmentUnmasked = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const {
      assignment,
      agentId,
      remark,
      source,
      range,
      batch,
      isRegistered,
      priorityGroup,
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

    if (source) filter.source = { $regex: source, $options: "i" };

    if (batch) filter.batch = { $regex: new RegExp(batch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };

    if (isRegistered !== undefined && isRegistered !== "") {
      filter.isRegistered = isRegistered === "true";
    }

    if (priorityGroup) {
      if (priorityGroup === "unassigned") filter["priorityGroup.no"] = null;
      else filter["priorityGroup.label"] = priorityGroup;
    }

    // Remark filter — use denormalised lastRemarks field for DB-level filtering
    if (remark) {
      if (remark === "Yet to Call") {
        filter.lastRemarks = { $in: [null, "", "Yet to Call"] };
      } else {
        filter.lastRemarks = remark;
      }
    }

    // Display sort — must be identical for both range and normal paths
    const DISPLAY_SORT = { "priorityGroup.no": 1, _id: 1 };

    const MAX_RANGE = 100000;

    // Range: slice row numbers X–Y in display order
    if (range) {
      const parts = range.split("-").map((v) => parseInt(v.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
        return sendError(next, "Invalid range format. Use 100-200", 400);
      }
      const [rangeMin, rangeMax] = parts;
      if (rangeMin < 1 || rangeMin > rangeMax) {
        return sendError(next, "Range minimum should be ≥ 1 and ≤ maximum", 400);
      }

      const rangeSize = Math.min(rangeMax - rangeMin + 1, MAX_RANGE); // cap at 1 lakh
      const rangeSkip = rangeMin - 1;

      // Count how many docs actually exist within this range window
      const totalFiltered = await CallingData.countDocuments(filter);
      const total = Math.max(0, Math.min(totalFiltered - rangeSkip, rangeSize));

      // ── idsOnly mode: stream just _id array for bulk email/whatsapp triggering ──
      // Used when frontend needs all IDs in a range (up to 1 lakh) for bulk send.
      // Streams chunked JSON to avoid memory spike.
      if (req.query.idsOnly === "true") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        res.write(`{"status":"success","message":"IDs fetched successfully","data":{"total":${total},"ids":[`);

        const cursor = CallingData.find(filter)
          .sort(DISPLAY_SORT)
          .skip(rangeSkip)
          .limit(rangeSize)
          .select("_id")
          .lean()
          .cursor({ batchSize: 2000 });

        let first = true;
        for await (const doc of cursor) {
          if (!first) res.write(",");
          res.write(JSON.stringify(doc._id));
          first = false;
        }
        res.write(`]}}`);
        res.end();
        return;
      }

      // ── Normal paginated display within range (for DataGrid) ──
      const pageSkip = (pageNum - 1) * limNum;
      const effectiveSkip = rangeSkip + pageSkip;
      const effectiveLimit = Math.min(rangeSize - pageSkip, limNum);

      if (effectiveLimit <= 0) {
        return sendResponse(res, 200, "Filtered database fetched successfully", {
          total, page: pageNum, limit: limNum,
          totalPages: Math.ceil(total / limNum),
          data: [],
        });
      }

      const data = await CallingData.find(filter)
        .sort(DISPLAY_SORT)
        .hint({ CampaignId: 1, "priorityGroup.no": 1 }) // use compound index for fast skip
        .skip(effectiveSkip)
        .limit(effectiveLimit)
        .populate({ path: "agentId", select: "employeeName email" })
        .lean();

      return sendResponse(res, 200, "Filtered database fetched successfully", {
        total,
        page: pageNum,
        limit: limNum,
        totalPages: Math.ceil(total / limNum),
        data,
      });
    }

    if (skip > 100_000) return sendError(next, "Page too deep. Use additional filters to narrow results.", 400);
    const [data, total] = await Promise.all([
      CallingData.find(filter)
        .sort(DISPLAY_SORT)
        .skip(skip)
        .limit(limNum)
        .populate({ path: "agentId", select: "employeeName email" })
        .lean(),
      CallingData.countDocuments(filter),
    ]);

    return sendResponse(res, 200, "Filtered database fetched successfully", {
      total,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(total / limNum),
      data,
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
      dataSourceType,
      range,
      batch,
      priorityGroup,
      page  = 1,
      limit = 20,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limNum  = parseInt(limit, 10);
    const skip    = (pageNum - 1) * limNum;

    // ── Base filter ──────────────────────────────────────────────────────────
    // Cast string IDs to ObjectId — Mongoose auto-casts for find/countDocuments
    // but NOT for aggregate() pipeline $match stages, causing the range count
    // aggregation to match 0 documents despite find() returning results.
    const toObjId = (id) =>
      id && mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : id;

    const filter = { CampaignId: toObjId(CampaignId), "discrepencyInData.status": { $ne: true } };

    if (assignment === "assigned")    filter.agentId = { $ne: null };
    if (assignment === "notassigned") filter.agentId = null;
    if (agentId) filter.agentId = toObjId(agentId);

    if (dataSourceType) {
      if (dataSourceType === "Kestone")          filter.dataSourceType = { $in: ["Kestone", "Both"] };
      else if (dataSourceType === "Client")      filter.dataSourceType = { $in: ["Client", "Both"] };
      else if (dataSourceType === "External")    filter.registrationSource = "External Registration";
      else if (dataSourceType === "nonExternal") filter.registrationSource = { $ne: "External Registration" };
      else                                       filter.dataSourceType = dataSourceType;
    }

    if (batch) {
      filter.batch = { $regex: new RegExp(escapeStringRegexp(batch), "i") };
    }

    if (priorityGroup === "unassigned") filter["priorityGroup.no"] = null;
    else if (priorityGroup)             filter["priorityGroup.label"] = priorityGroup;

    // ── Remark filter — uses denormalised lastRemarks field on CallingData ───
    // No callHistory population or in-memory scan needed.
    if (remark) {
      if (remark === "Yet to Call") {
        // null/""  = never called (default); "Yet to Call" = older records set as string
        filter.lastRemarks = { $in: [null, "", "Yet to Call"] };
      } else {
        filter.lastRemarks = remark;
      }
    }

    const applyMask = (row) => ({
      ...row,
      Contact_Direct_Phone1: maskPhone(row.Contact_Direct_Phone1),
      Contact_Direct_Phone2: maskPhone(row.Contact_Direct_Phone2),
      Mobile_No:             maskPhone(row.Mobile_No),
      Office_Email_1:        maskEmail(row.Office_Email_1),
      Office_Email_2:        maskEmail(row.Office_Email_2),
      Personal_Email1:       maskEmail(row.Personal_Email1),
      Personal_Email2:       maskEmail(row.Personal_Email2),
    });

    // ── PATH 1: no range — parallel count + data queries ────────────────────
    if (!range) {
      // Guard against pathologically deep skip: page 5001 @ limit 20 = skip 100k.
      // At that depth MongoDB must scan 100k docs to reach the offset — use
      // range or additional filters to narrow the dataset instead.
      const MAX_SKIP = 100_000;
      if (skip > MAX_SKIP) {
        return sendError(
          next,
          "Page too deep. Use the range filter or narrow results with additional filters.",
          400
        );
      }

      const [docs, total] = await Promise.all([
        CallingData.find(filter)
          .populate({ path: "agentId", select: "employeeName email" })
          .sort({ "priorityGroup.no": 1 })
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

    // ── PATH 2: range ─────────────────────────────────────────────────────────
    // Sort by _id asc so row positions are stable and consistent.
    const parts = range.split("-").map((v) => parseInt(v.trim(), 10));
    if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
      return sendError(next, "Invalid range format. Use 100-200", 400);
    }
    const [min, max] = parts;
    if (min < 1 || min > max) {
      return sendError(next, "Range minimum must be >= 1 and <= maximum", 400);
    }

    // Count only up to `max` records — stops the scan early instead of
    // counting all lakh records just to validate a small range (e.g., 1-1000).
    const [countResult] = await CallingData.aggregate([
      { $match: filter },
      { $limit: max },          // ← stops scanning after `max` docs
      { $count: "total" },
    ]);
    const totalInFilter = countResult?.total ?? 0;

    // Early-exit: no records match, or range starts beyond the last matching row.
    // Avoids a negative dbSkip that makes MongoDB throw a 500.
    if (totalInFilter === 0 || min > totalInFilter) {
      return sendResponse(res, 200, "Filtered database fetched successfully", {
        total: 0, page: pageNum, limit: limNum, totalPages: 0, data: [],
      });
    }

    const clampedMin   = Math.min(min, totalInFilter);
    const clampedMax   = Math.min(max, totalInFilter);
    const totalInRange = Math.max(0, clampedMax - clampedMin + 1);

    if (totalInRange === 0 || skip >= totalInRange) {
      return sendResponse(res, 200, "Filtered database fetched successfully", {
        total: totalInRange, page: pageNum, limit: limNum,
        totalPages: Math.ceil(totalInRange / limNum), data: [],
      });
    }

    // dbSkip is bounded by (max - 1), so it stays small regardless of total
    // collection size — no deep-skip performance problem in PATH 2.
    const dbSkip  = (clampedMin - 1) + skip;
    const dbLimit = Math.min(limNum, totalInRange - skip);

    const docs = await CallingData.find(filter)
      .populate({ path: "agentId", select: "employeeName email" })
      .sort({ _id: 1 })
      .skip(dbSkip)
      .limit(dbLimit)
      .lean();

    return sendResponse(res, 200, "Filtered database fetched successfully", {
      total: totalInRange,
      page: pageNum,
      limit: limNum,
      totalPages: Math.ceil(totalInRange / limNum),
      data: docs.map(applyMask),
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const assignCallingDataToAgents = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, callingDataIds, pmId, pmName, campaignId } = req.body;
    const { range, batch, remark, priorityGroup, dataSourceType } = req.query;

    if (!agentId || !pmId || !pmName) {
      return sendError(
        next,
        "AgentId, ProjectManager Id, and ProjectManager Name are required",
        400
      );
    }

    let finalCallingDataIds = [];

    if (range) {
      // Range mode — ignore callingDataIds, resolve by position within the campaign
      if (!campaignId) {
        return sendError(next, "campaignId is required when using range assignment", 400);
      }

      const match = range.match(/^(\d+)-(\d+)$/);
      if (!match) {
        return sendError(next, "Invalid range format. Use 'start-end' (e.g., 1-10)", 400);
      }

      const start = parseInt(match[1], 10);
      const end   = parseInt(match[2], 10);

      if (start < 1 || end < start) {
        return sendError(next, "Invalid range. Start must be >= 1 and end must be >= start", 400);
      }

      // Build filter — same fields as getDatabaseByAssignment so display matches assignment
      const rangeFilter = {
        CampaignId: campaignId,
        agentId: null,
        "discrepencyInData.status": { $ne: true },
      };
      if (batch)         rangeFilter.batch = { $regex: new RegExp(escapeStringRegexp(batch), "i") };
      if (remark) {
        if (remark === "Yet to Call") rangeFilter.lastRemarks = { $in: [null, "", "Yet to Call"] };
        else                          rangeFilter.lastRemarks = remark;
      }
      if (priorityGroup === "unassigned") rangeFilter["priorityGroup.no"] = null;
      else if (priorityGroup)             rangeFilter["priorityGroup.label"] = priorityGroup;
      if (dataSourceType === "External")    rangeFilter.registrationSource = "External Registration";
      else if (dataSourceType === "nonExternal") rangeFilter.registrationSource = { $ne: "External Registration" };

      // Fetch only the _ids within the range — skip/limit is efficient even for large ranges
      const rangeRecords = await CallingData.find(rangeFilter, { _id: 1 })
        .sort({ _id: 1 })
        .skip(start - 1)
        .limit(end - start + 1)
        .lean();

      if (!rangeRecords.length) {
        return sendError(next, `No unassigned records found in range ${start}-${end}`, 404);
      }

      finalCallingDataIds = rangeRecords.map((item) => item._id.toString());
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
    const { callingDataIds, agentId, campaignId } = req.body;
    const { range, batch, remark, priorityGroup, dataSourceType } = req.query;

    let finalCallingDataIds = [];

    if (range) {
      // Range mode — resolve by position within the agent's assigned records
      if (!campaignId || !agentId) {
        return sendError(next, "campaignId and agentId are required when using range unassignment", 400);
      }

      const match = range.match(/^(\d+)-(\d+)$/);
      if (!match) {
        return sendError(next, "Invalid range format. Use 'start-end' (e.g., 1-100)", 400);
      }

      const start = parseInt(match[1], 10);
      const end   = parseInt(match[2], 10);

      if (start < 1 || end < start) {
        return sendError(next, "Invalid range. Start must be >= 1 and end must be >= start", 400);
      }

      // Build filter — assigned records of this agent matching active filters
      const rangeFilter = {
        CampaignId: campaignId,
        agentId,
        "discrepencyInData.status": { $ne: true },
      };
      if (batch)  rangeFilter.batch = { $regex: new RegExp(escapeStringRegexp(batch), "i") };
      if (remark) {
        if (remark === "Yet to Call") rangeFilter.lastRemarks = { $in: [null, "", "Yet to Call"] };
        else                          rangeFilter.lastRemarks = remark;
      }
      if (priorityGroup === "unassigned") rangeFilter["priorityGroup.no"] = null;
      else if (priorityGroup)             rangeFilter["priorityGroup.label"] = priorityGroup;
      if (dataSourceType === "External")       rangeFilter.registrationSource = "External Registration";
      else if (dataSourceType === "nonExternal") rangeFilter.registrationSource = { $ne: "External Registration" };

      const rangeRecords = await CallingData.find(rangeFilter, { _id: 1 })
        .sort({ _id: 1 })
        .skip(start - 1)
        .limit(end - start + 1)
        .lean();

      if (!rangeRecords.length) {
        return sendError(next, `No assigned records found in range ${start}-${end}`, 404);
      }

      finalCallingDataIds = rangeRecords.map((item) => item._id.toString());
    } else {
      // Explicit IDs mode
      if (!Array.isArray(callingDataIds) || callingDataIds.length === 0) {
        return sendError(next, "Either 'range' query parameter or 'callingDataIds' in body is required", 400);
      }
      finalCallingDataIds = callingDataIds;
    }

    const result = await CallingData.updateMany(
      { _id: { $in: finalCallingDataIds } },
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
    const {
      callingDataIds,          // explicit mode: array of _ids
      newAgentId,              // required in all modes
      campaignId:  bodyCampaignId,   // required for range / remark mode
      fromAgentId,             // optional: only reassign records currently held by this agent
      remarks,                 // remark mode: array of lastRemarks values to match
      range: bodyRange,        // range mode from body: "1-1825"
    } = req.body;

    // Body range always applies.
    // Query-string range only applies when no explicit callingDataIds are in the body
    // (prevents the URL ?range= from overriding a manual checkbox selection).
    const hasExplicitIds = Array.isArray(callingDataIds) && callingDataIds.length > 0;
    const rangeStr   = bodyRange || (!hasExplicitIds ? req.query.range : null) || null;
    const campaignId = bodyCampaignId || req.query.campaignId || null;

    if (!newAgentId) {
      return sendError(next, "newAgentId is required", 400);
    }

    // ── Resolve which records to reassign ──────────────────────────────────
    let records = [];

    // range always wins — if range is present, ignore callingDataIds
    const isRangeOrRemark  = !!(rangeStr || (Array.isArray(remarks) && remarks.length > 0));
    const isExplicitMode   = !isRangeOrRemark && Array.isArray(callingDataIds) && callingDataIds.length > 0;

    if (isExplicitMode) {
      // ── Mode 1: explicit IDs ─────────────────────────────────────────────
      records = await CallingData.find(
        { _id: { $in: callingDataIds } },
        { agentId: 1 }
      ).lean();

      if (!records.length) {
        return sendError(next, "No records found for the provided callingDataIds", 404);
      }

    } else if (isRangeOrRemark) {
      // ── Mode 2: range and / or remark filter ────────────────────────────
      if (!campaignId) {
        return sendError(next, "campaignId is required for range or remark based reassignment", 400);
      }

      const filter = { CampaignId: campaignId };

      // Optionally restrict to records owned by a specific agent
      if (fromAgentId) filter.agentId = fromAgentId;

      // Remark filter — match any of the provided lastRemarks values.
      // "Yet to Call" is a UI label for records that have never been called (lastRemarks: null).
      if (Array.isArray(remarks) && remarks.length > 0) {
        const mappedRemarks = remarks.map((r) =>
          r === "Yet to Call" ? null : r
        );
        const hasNull = mappedRemarks.includes(null);
        const nonNull = mappedRemarks.filter((r) => r !== null);

        if (hasNull && nonNull.length > 0) {
          filter.$or = [
            { lastRemarks: { $in: nonNull } },
            { lastRemarks: null },
          ];
        } else if (hasNull) {
          filter.lastRemarks = null;
        } else {
          filter.lastRemarks = { $in: nonNull };
        }
      }

      if (rangeStr) {
        // ── Range: "start-end" (1-indexed, inclusive) ──────────────────────
        const parts = rangeStr.split("-");
        if (parts.length !== 2) {
          return sendError(next, "range must be in format 'start-end' e.g. '1-1825'", 400);
        }
        const start = parseInt(parts[0], 10);
        const end   = parseInt(parts[1], 10);
        if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
          return sendError(next, "Invalid range values. start must be ≥ 1 and end must be ≥ start", 400);
        }

        records = await CallingData.find(filter, { agentId: 1 })
          .sort({ _id: 1 })                  // consistent ordering by insertion
          .skip(start - 1)
          .limit(end - start + 1)
          .lean();
      } else {
        // ── Remark-only: no range limit — match all records with those remarks ──
        records = await CallingData.find(filter, { agentId: 1 })
          .sort({ _id: 1 })
          .lean();
      }

      console.log("[reassign] filter =>", JSON.stringify(filter));
      console.log("[reassign] records found =>", records.length);

      if (!records.length) {
        return sendError(next, "No records matched the given range / remark filter", 404);
      }

    } else {
      return sendError(
        next,
        "Provide either callingDataIds (explicit), or campaignId + range / remarks (filter mode)",
        400
      );
    }

    // ── Bulk reassign ──────────────────────────────────────────────────────
    const bulkOps = records.map((rec) => ({
      updateOne: {
        filter: { _id: rec._id },
        update: {
          $set: {
            agentId:                 newAgentId,
            "reassigned_to.status":  true,
          },
          $push: {
            "reassigned_to.previously_assigned_to": {
              agentId:      rec.agentId,
              unassignedAt: new Date(),
            },
          },
        },
      },
    }));

    const result = await CallingData.bulkWrite(bulkOps);

    // ── Fire-and-forget email notification ────────────────────────────────
    if (result.modifiedCount > 0) {
      const sampleId = records[0]._id;
      Promise.all([
        User.findById(newAgentId).select("employeeName email").lean(),
        CallingData.findById(sampleId).populate({ path: "CampaignId", select: "name" }).lean(),
      ])
        .then(([agent, sampleRecord]) => {
          if (!agent?.email) return;
          sendEmail(
            agent.email,
            `Calling data reassigned to you`,
            callingDataReassignedToAgentTemplate({
              agentName:    agent.employeeName,
              campaignName: sampleRecord?.CampaignId?.name || "—",
              count:        result.modifiedCount,
            }),
            {
              trigger:         EmailTrigger.CALLING_DATA_REASSIGNED_TO_AGENT,
              campaignId:      sampleRecord?.CampaignId?._id || null,
              recipientUserId: agent._id,
            }
          );
        })
        .catch((err) => console.error(`[Email] Reassignment notification failed: ${err.message}`));
    }

    return sendResponse(res, 200, `${result.modifiedCount} records reassigned successfully`, {
      matched:  records.length,
      modified: result.modifiedCount,
      mode:     isExplicitMode ? "explicit" : (rangeStr && remarks?.length ? "range+remark" : rangeStr ? "range" : "remark"),
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
const CALLING_DATA_ALLOWED_FIELDS = [
  "Salutation", "First_Name", "Last_Name", "Full_Name", "Gender",
  "Job_Title", "Job_Seniority", "Job_Seniority_Secondary", "Job_Seniority_Tertiary", "Job_Function",
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
  "lastRemarks",
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

    // Only show priority items from active campaigns
    const activeCampaigns = await Campaign.find({ status: "active" }).select("_id").lean();
    const activeCampaignIds = activeCampaigns.map((c) => c._id);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const priorities = await CallingData.find({
      agentId: new mongoose.Types.ObjectId(agentId),
      CampaignId: { $in: activeCampaignIds },
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
  "Job_Title",
  "Job_Seniority",
  "Job_Seniority_Secondary",
  "Job_Seniority_Tertiary",
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

    // distinct() already returns null/empty values — no separate exists() query needed.
    // This halves the DB round-trips from 30 to 15.
    const results = await Promise.all(
      PRIORITY_FILTER_FIELDS.map(async (field) => {
        const vals = await CallingData.distinct(field, { CampaignId: campaignId });
        const hasBlank = vals.some((v) => !v || String(v).trim() === "");
        const filled = vals.filter((v) => v && String(v).trim()).sort();
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

    let baseQuery = { CampaignId: campaignId, companyExcluded: { $ne: true } };

    // scope param — used when previewing exclusion-based priority assignment
    if (req.query.scope === "registered") baseQuery.isRegistered = true;

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

    // Build query — always skip "Excluded" records regardless of overwrite flag
    let baseQuery = { CampaignId: campaignId, companyExcluded: { $ne: true } };
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

    const campaignObjId = mongoose.Types.ObjectId.isValid(campaignId)
      ? new mongoose.Types.ObjectId(campaignId)
      : campaignId;

    const [groups, unassignedCount] = await Promise.all([
      CallingData.aggregate([
        { $match: { CampaignId: campaignObjId, "priorityGroup.no": { $ne: null } } },
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
      CallingData.countDocuments({ CampaignId: campaignId, "priorityGroup.no": null, companyExcluded: { $ne: true } }),
    ]);

    return sendResponse(res, 200, "Priority groups fetched", { groups, unassignedCount });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * GET /callingData/:campaignId/distinctFilterValues
 * Returns distinct batch values and priority group labels for a campaign.
 */
const getDistinctFilterValues = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    const campaignObjId = mongoose.Types.ObjectId.isValid(campaignId)
      ? new mongoose.Types.ObjectId(campaignId)
      : campaignId;

    const [batches, priorities] = await Promise.all([
      CallingData.distinct("batch", { CampaignId: campaignObjId, batch: { $nin: [null, ""] } }),
      CallingData.aggregate([
        { $match: { CampaignId: campaignObjId, "priorityGroup.no": { $ne: null } } },
        { $group: { _id: "$priorityGroup.no", label: { $first: "$priorityGroup.label" } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, no: "$_id", label: 1 } },
      ]),
    ]);

    return sendResponse(res, 200, "Distinct filter values fetched", {
      batches: batches.sort(),
      priorities,
    });
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
// External Upload (feature-flagged via ENABLE_EXTERNAL_UPLOAD env var)
// ═══════════════════════════════════════════════════════════════════════════

// Mandatory fields marked with * — validated on upload
const EXTERNAL_UPLOAD_MANDATORY = [
  "Full_Name", "Mobile_No", "Job_Title", "Contact_City",
  "Office_Email_1", "Company_Name",
];

const EXTERNAL_UPLOAD_COLUMNS = [
  // ── Mandatory fields ──
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

/**
 * GET /api/callingData/external-upload-template
 * Returns a blank XLSX file with all column headers — no fields mandatory.
 */
const downloadExternalUploadTemplate = asyncHandler(async (req, res) => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template");

  // Set columns first so widths apply
  ws.columns = EXTERNAL_UPLOAD_COLUMNS.map((col) => ({
    header: col,
    key: col,
    width: EXTERNAL_UPLOAD_MANDATORY.includes(col) ? 26 : 22,
  }));

  // Style header row (row 1 auto-created by ws.columns)
  const headerRow = ws.getRow(1);
  headerRow.height = 20;
  EXTERNAL_UPLOAD_COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    const isMandatory = EXTERNAL_UPLOAD_MANDATORY.includes(col);
    cell.font      = { bold: true, color: { argb: isMandatory ? "FFCC0000" : "FF000000" } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: isMandatory ? "FFFFF0F0" : "FFF2F2F2" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  // Notes row (row 2)
  const notesRow = ws.addRow(
    EXTERNAL_UPLOAD_COLUMNS.map((col) => {
      if (EXTERNAL_UPLOAD_MANDATORY.includes(col)) return "(required)";
      return "";
    })
  );
  notesRow.font = { italic: true, color: { argb: "FF888888" }, size: 9 };

  ws.views = [{ state: "frozen", ySplit: 2 }];

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Disposition", 'attachment; filename="external_upload_template.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return res.send(buf);
});

/**
 * POST /api/callingData/external-upload
 * Uploads calling data from Excel/XLS directly — no fields are mandatory.
 * Data is stored with dataSourceType "External".
 */
const externalUploadCallingData = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.body;
    if (!CampaignId) return sendError(next, "CampaignId is required", 400);
    if (!req.file)   return sendError(next, "No file uploaded", 400);

    const campaign = await Campaign.findById(CampaignId).select("isExternalSheetUploadAllowed").lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);
    if (campaign.isExternalSheetUploadAllowed === false) {
      return sendError(next, "External sheet upload is disabled for this campaign.", 403);
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const json     = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!json.length) return sendError(next, "Uploaded file is empty or invalid", 400);

    // ── Helpers ────────────────────────────────────────────────────────────
    const parseBool = (v) => {
      const s = String(v || "").trim().toLowerCase();
      if (s === "yes" || s === "true" || s === "1") return true;
      if (s === "no"  || s === "false"|| s === "0") return false;
      return null; // invalid
    };

    const parseDate = (v) => {
      if (!v) return null;
      // ExcelJS numeric serial date
      if (typeof v === "number") {
        const d = XLSX.SSF.parse_date_code(v);
        if (d) return new Date(d.y, d.m - 1, d.d);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    // ── Mandatory validation ───────────────────────────────────────────────
    const validRows    = [];
    const invalidRows  = [];

    for (const row of json) {
      const missing = EXTERNAL_UPLOAD_MANDATORY.filter((f) => {
        const v = String(row[f] || "").trim();
        return !v;
      });

      if (missing.length > 0) {
        invalidRows.push({ ...row, _Validation_Errors: missing.join(", ") });
      } else {
        validRows.push(row);
      }
    }

    // Auto-increment batch label per campaign (Batch1, Batch2, …)
    const existingBatches = await CallingData.distinct("batch", {
      CampaignId,
      dataSourceType: "External",
    });
    const batchNo    = existingBatches.filter(Boolean).length + 1;
    const batchLabel = `Batch-${batchNo}`;

    // ── Match existing records by Mobile_No or Office_Email_1 ─────────────
    const MATCH_MOBILE = "Mobile_No";
    const MATCH_EMAIL  = "Office_Email_1";

    const allMobiles = new Set();
    const allEmails  = new Set();
    for (const row of validRows) {
      const mob = String(row[MATCH_MOBILE] || "").trim();
      const eml = String(row[MATCH_EMAIL]  || "").trim().toLowerCase();
      if (mob) allMobiles.add(mob);
      if (eml) allEmails.add(eml);
    }

    // Also check all other email/phone fields for full-duplicate detection (new inserts)
    const ALL_EMAIL_FIELDS  = ["Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2"];
    const ALL_MOBILE_FIELDS = ["Mobile_No", "Contact_Direct_Phone1", "Contact_Direct_Phone2"];

    const orConditions = [];
    if (allMobiles.size) orConditions.push({ Mobile_No:       { $in: [...allMobiles] } });
    if (allEmails.size)  orConditions.push({ Office_Email_1:  { $in: [...allEmails]  } });

    // existingMap: "mobile:<v>" or "email:<v>" → { _id, Full_Name, Company_Name }
    const existingMap = new Map();
    if (orConditions.length > 0) {
      const existing = await CallingData.find(
        { CampaignId, $or: orConditions },
        "_id Full_Name Company_Name Mobile_No Office_Email_1"
      ).lean();
      for (const doc of existing) {
        const mob = String(doc.Mobile_No      || "").trim();
        const eml = String(doc.Office_Email_1 || "").trim().toLowerCase();
        if (mob) existingMap.set(`mobile:${mob}`, doc);
        if (eml) existingMap.set(`email:${eml}`,  doc);
      }
    }

    // takenSet for intra-file duplicate prevention (new inserts only)
    const takenSet = new Set();
    for (const [key, doc] of existingMap) takenSet.add(key);

    const toInsert    = [];
    const updatedRows = []; // already-existing rows skipped
    const skippedIntraFile = [];

    const buildEntry = (row) => ({
      CampaignId,
      UploadedBy:               req.user._id,
      Contact_Source:           row.Contact_Source                  || "",
      Contact_Create_Date:      row.Contact_Create_Date             || "",
      Salutation:               row.Salutation                      || "",
      First_Name:               row.First_Name                      || "",
      Last_Name:                row.Last_Name                       || "",
      Full_Name:                row.Full_Name                       || "",
      Gender:                   row.Gender                          || "",
      Job_Title:                row.Job_Title                       || "",
      Job_Seniority:            row.Job_Seniority                   || "",
      Job_Seniority_Secondary:  row.Job_Seniority_Secondary         || "",
      Job_Seniority_Tertiary:   row.Job_Seniority_Tertiary          || "",
      Job_Function:             row.Job_Function                    || "",
      Contact_Address_1:        row.Contact_Address_1               || "",
      Contact_Address_2:        row.Contact_Address_2               || "",
      Contact_Address_3:        row.Contact_Address_3               || "",
      Contact_City:             row.Contact_City                    || "",
      Contact_Pin:              String(row.Contact_Pin              || ""),
      Contact_State:            row.Contact_State                   || "",
      Contact_Region:           row.Contact_Region                  || "",
      Contact_Country:          row.Contact_Country                 || "",
      Contact_STD_ISD_Code:     String(row.Contact_STD_ISD_Code     || ""),
      Contact_Location_Tier:    row.Contact_Location_Tier           || "",
      Contact_Direct_Phone1:    String(row.Contact_Direct_Phone1    || ""),
      Contact_Direct_Phone2:    String(row.Contact_Direct_Phone2    || ""),
      Contact_Extn_No:          String(row.Contact_Extn_No          || ""),
      Mobile_No:                String(row.Mobile_No                || ""),
      Office_Email_1:           row.Office_Email_1                  || "",
      Office_Email_2:           row.Office_Email_2                  || "",
      Personal_Email1:          row.Personal_Email1                 || "",
      Personal_Email2:          row.Personal_Email2                 || "",
      Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile        || "",
      Company_ID_Kestone:       row.Company_ID_Kestone              || "",
      Company_Source:           row.Company_Source                  || "",
      Company_Name:             row.Company_Name                    || "",
      Year_Founded:             String(row.Year_Founded             || ""),
      Turnover_Range:           row.Turnover_Range                  || "",
      Employees_Range:          row.Employees_Range                 || "",
      Industry:                 row.Industry                        || "",
      Sub_Industry:             row.Sub_Industry                    || "",
      Company_Segment:          row.Company_Segment                 || "",
      Website:                  row.Website                         || "",
      Company_LinkedIn_Profile: row.Company_LinkedIn_Profile        || "",
      Company_Phone1:           String(row.Company_Phone1           || ""),
      Company_Phone2:           String(row.Company_Phone2           || ""),
      source:                   "External",
      batch:                    batchLabel,
      dataSourceType:           "External",
      isDataSourceApproved:     false,
    });

    for (const row of validRows) {
      const mob = String(row[MATCH_MOBILE] || "").trim();
      const eml = String(row[MATCH_EMAIL]  || "").trim().toLowerCase();

      const matchKey = mob && existingMap.has(`mobile:${mob}`) ? `mobile:${mob}`
                     : eml && existingMap.has(`email:${eml}`)  ? `email:${eml}`
                     : null;

      if (matchKey) {
        // Already exists in campaign — skip (record as duplicate)
        const existingDoc = existingMap.get(matchKey);
        updatedRows.push({
          ...row,
          _Action: "Skipped (already exists)",
          _Matched_By: matchKey.split(":")[0],
          _Existing_Full_Name: existingDoc.Full_Name || "",
        });
      } else {
        // New record — check intra-file duplicates
        const intraKey = mob ? `mobile:${mob}` : eml ? `email:${eml}` : null;
        if (intraKey && takenSet.has(intraKey)) {
          skippedIntraFile.push({ ...row, _Action: "Skipped (intra-file duplicate)" });
        } else {
          toInsert.push(buildEntry(row));
          // Mark as taken
          if (mob) takenSet.add(`mobile:${mob}`);
          if (eml) takenSet.add(`email:${eml}`);
        }
      }
    }

    // ── Insert new records ─────────────────────────────────────────────────
    let inserted = 0;
    let failed   = 0;
    if (toInsert.length > 0) {
      try {
        const result = await CallingData.insertMany(toInsert, { ordered: false });
        inserted = result.length;
      } catch (bulkErr) {
        inserted = bulkErr.insertedDocs?.length ?? 0;
        failed   = toInsert.length - inserted;
      }
    }

    if (inserted > 0) {
      await Campaign.findByIdAndUpdate(CampaignId, { isCallingDataAssigned: true });
    }

    // ── Build result XLSX ──────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    const summaryRows = [
      ["Metric",                          "Count"],
      ["Total Rows in File",              json.length],
      ["Valid Rows",                      validRows.length],
      ["New Records Inserted",            inserted],
      ["Already Exists (skipped)",        updatedRows.length],
      ["Validation Failed (skipped)",     invalidRows.length],
      ["Intra-file Duplicates (skipped)", skippedIntraFile.length],
      ["Insert Failed",                   failed],
      ["Batch Assigned",                  batchLabel],
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    summaryWs["!cols"] = [{ wch: 32 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    if (updatedRows.length > 0) {
      const updWs = XLSX.utils.json_to_sheet(updatedRows);
      updWs["!cols"] = Object.keys(updatedRows[0]).map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, updWs, "Already Exists");
    }

    if (invalidRows.length > 0) {
      const invWs = XLSX.utils.json_to_sheet(invalidRows);
      invWs["!cols"] = Object.keys(invalidRows[0]).map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, invWs, "Validation Failed");
    }

    if (skippedIntraFile.length > 0) {
      const skipWs = XLSX.utils.json_to_sheet(skippedIntraFile);
      skipWs["!cols"] = Object.keys(skippedIntraFile[0]).map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, skipWs, "Intra-file Duplicates");
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename="upload_result_${batchLabel}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("X-Inserted-Count",   String(inserted));
    res.setHeader("X-Duplicate-Count",  String(updatedRows.length));
    res.setHeader("X-Failed-Count",     String(failed + invalidRows.length));
    res.setHeader("X-Total-Count",      String(json.length));
    res.setHeader("X-Batch-Label",      batchLabel);
    res.setHeader("Access-Control-Expose-Headers",
      "X-Inserted-Count,X-Duplicate-Count,X-Failed-Count,X-Total-Count,X-Batch-Label"
    );

    return res.send(buf);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════

const resetNoResponseToYetToCall = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "Campaign ID is required", 400);

    const result = await CallingData.updateMany(
      { CampaignId: campaignId, lastRemarks: REMARK_STATUS.NO_RESPONSE },
      { $set: { lastRemarks: null, lastCallingDate: null } }
    );

    return sendResponse(res, 200, `${result.modifiedCount} records reset from "${REMARK_STATUS.NO_RESPONSE}" to Yet to Call`, {
      matched: result.matchedCount,
      updated: result.modifiedCount,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ─── Reshuffle Calling Data Among Agents ─────────────────────────────────────
// POST /callingData/reshuffleCallingData
// Body: { campaignId, agentIds[], fromAgentIds[], remarks[], range, batch, priorityGroup }
// Fetches all matching records, shuffles them, distributes round-robin to agentIds.
const reshuffleCallingData = asyncHandler(async (req, res, next) => {
  try {
    const {
      campaignId,
      agentIds,       // target agents to distribute to
      fromAgentIds,   // optional: only reshuffle records from these agents
      remarks,        // optional: filter by lastRemarks
      range,          // optional: "start-end" e.g. "1-500"
      batch,          // optional: batch filter
      priorityGroup,  // optional: priorityGroup.label filter
    } = req.body;

    if (!campaignId) return sendError(next, "campaignId is required", 400);
    if (!Array.isArray(agentIds) || agentIds.length < 2)
      return sendError(next, "At least 2 agentIds are required for reshuffling", 400);

    // Build filter — only assigned records
    const filter = {
      CampaignId: new mongoose.Types.ObjectId(campaignId),
      agentId:    { $exists: true, $ne: null },
    };

    if (Array.isArray(fromAgentIds) && fromAgentIds.length > 0) {
      filter.agentId = { $in: fromAgentIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    if (Array.isArray(remarks) && remarks.length > 0) {
      const mappedRemarks = remarks.map((r) => (r === "Yet to Call" ? null : r));
      const hasNull = mappedRemarks.includes(null);
      const nonNull = mappedRemarks.filter((r) => r !== null);
      if (hasNull && nonNull.length > 0) {
        filter.$or = [{ lastRemarks: { $in: nonNull } }, { lastRemarks: null }];
      } else if (hasNull) {
        filter.lastRemarks = null;
      } else {
        filter.lastRemarks = { $in: nonNull };
      }
    }

    if (batch) filter.batch = batch;
    if (priorityGroup) filter["priorityGroup.label"] = priorityGroup;

    // Fetch _id + agentId (needed to prevent self-reassignment)
    // Hard cap at 50,000 to prevent loading 1 lakh records into Node.js memory at once
    const RESHUFFLE_MAX = 50_000;
    let query = CallingData.find(filter, { _id: 1, agentId: 1 }).sort({ _id: 1 });

    if (range) {
      const parts = range.split("-");
      if (parts.length !== 2) return sendError(next, "range must be 'start-end' e.g. '1-500'", 400);
      const start = parseInt(parts[0], 10);
      const end   = parseInt(parts[1], 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end < start)
        return sendError(next, "Invalid range values", 400);
      if (end - start + 1 > RESHUFFLE_MAX)
        return sendError(next, `Range too large. Maximum ${RESHUFFLE_MAX} records per reshuffle.`, 400);
      query = query.skip(start - 1).limit(end - start + 1);
    } else {
      query = query.limit(RESHUFFLE_MAX);
    }

    const records = await query.lean();

    if (!records.length)
      return sendError(next, "No records matched the given filters", 404);

    // Fisher-Yates shuffle the records
    for (let i = records.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [records[i], records[j]] = [records[j], records[i]];
    }

    // Distribute — ensure no agent gets their own records back
    const agentStrIds    = agentIds.map(String);
    const agentObjectIds = agentIds.map((id) => new mongoose.Types.ObjectId(id));

    // Track how many records each target agent has received so far (for even distribution)
    const perAgent = {};
    agentStrIds.forEach((id) => { perAgent[id] = 0; });

    const now = new Date();

    const bulkOps = records.map((rec) => {
      const originalAgentId = String(rec.agentId || "");

      // Pick the target agent with the fewest assignments so far that is NOT the original owner
      let bestIdx = -1;
      let bestCount = Infinity;
      for (let i = 0; i < agentStrIds.length; i++) {
        if (agentStrIds[i] === originalAgentId) continue; // never reassign back to original owner
        if (perAgent[agentStrIds[i]] < bestCount) {
          bestCount = perAgent[agentStrIds[i]];
          bestIdx   = i;
        }
      }

      // Fallback: only triggered if every target agent IS the original (edge case with 1 target = self)
      if (bestIdx === -1) {
        bestIdx = agentStrIds.reduce((minIdx, id, idx) =>
          perAgent[id] < perAgent[agentStrIds[minIdx]] ? idx : minIdx, 0);
      }

      perAgent[agentStrIds[bestIdx]] += 1;

      return {
        updateOne: {
          filter: { _id: rec._id },
          update: {
            $set: {
              agentId:                agentObjectIds[bestIdx],
              "reassigned_to.status": true,
            },
            $push: {
              "reassigned_to.previously_assigned_to": {
                agentId:      rec.agentId || null,
                unassignedAt: now,
              },
            },
          },
        },
      };
    });

    const result = await CallingData.bulkWrite(bulkOps);

    return sendResponse(res, 200, `${result.modifiedCount} records reshuffled among ${agentIds.length} agents`, {
      total: records.length,
      modified: result.modifiedCount,
      perAgent,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /callingData/:campaignId/distinctCompanies?search=xxx&limit=30
 * Returns distinct Company_Name values in this campaign matching the search term.
 * Returns top `limit` results (default 30, max 100) sorted alphabetically.
 */
const getDistinctCampaignCompanies = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const search = (req.query.search || "").trim();
    const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    // Aggregation pipelines do NOT auto-cast strings → ObjectId; cast explicitly
    const campObjId = new mongoose.Types.ObjectId(campaignId);
    const matchStage = { CampaignId: campObjId };
    if (search) matchStage.Company_Name = { $regex: search, $options: "i" };

    const results = await CallingData.aggregate([
      { $match: matchStage },
      { $group: { _id: "$Company_Name" } },
      { $match: { _id: { $ne: null, $ne: "" } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, name: "$_id" } },
    ]);

    const companies = results.map((r) => r.name).filter(Boolean);
    return sendResponse(res, 200, "Distinct companies fetched", { companies });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * POST /callingData/:campaignId/matchCompanyNames
 * Body: { names: string[] }
 * Server-side fuzzy match of uploaded company names against this campaign's calling data.
 * Returns { matched: string[], notMatched: string[] }
 */
const matchCampaignCompanyNames = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { names } = req.body;
    if (!campaignId) return sendError(next, "campaignId is required", 400);
    if (!Array.isArray(names) || names.length === 0)
      return sendError(next, "names array required", 400);

    // Load all distinct company names for this campaign (server memory, not client)
    const allRaw = await CallingData.distinct("Company_Name", { CampaignId: campaignId });
    const campaignCompanies = allRaw.filter(Boolean);

    // Tier-1 key: lowercase + remove all spaces (handles case & spacing differences)
    const key1 = (s) => (s || "").toLowerCase().replace(/\s/g, "");

    // Tier-2 key: same + strip common business suffixes
    // e.g. "Kestone Solutions Pvt Ltd" and "Kestone Solutions" both → "kestonesolutions"
    const SUFFIX = /\b(pvt|private|public|ltd|limited|llp|llc|inc|corp|corporation|co|group|india|global|international|solutions|services|technologies|technology|tech|holdings|ventures|enterprises|enterprise|industries|industry|infra|infrastructure|management|consulting|consultancy|associates|partners|exports|imports|trading|systems|system|infotech|digital|media|communications|works|worldwide)\b/gi;
    const key2 = (s) => key1(s.replace(SUFFIX, ""));

    // Build both lookup maps
    const exactMap    = new Map(); // key1 → original
    const strippedMap = new Map(); // key2 → original
    for (const original of campaignCompanies) {
      const k1 = key1(original);
      const k2 = key2(original);
      if (k1 && !exactMap.has(k1))    exactMap.set(k1, original);
      if (k2 && !strippedMap.has(k2)) strippedMap.set(k2, original);
    }

    const matched     = [];
    const notMatched  = [];
    const selectedSet = new Set();

    for (const inputName of names) {
      if (!inputName) { notMatched.push(inputName); continue; }

      // Tier 1: exact (case + space insensitive)
      const k1 = key1(inputName);
      if (k1 && exactMap.has(k1)) {
        const original = exactMap.get(k1);
        if (!selectedSet.has(original)) { selectedSet.add(original); matched.push(original); }
        continue;
      }

      // Tier 2: suffix-stripped (handles "Pvt Ltd" missing/extra on either side)
      const k2 = key2(inputName);
      if (k2 && strippedMap.has(k2)) {
        const original = strippedMap.get(k2);
        if (!selectedSet.has(original)) { selectedSet.add(original); matched.push(original); }
        continue;
      }

      notMatched.push(inputName);
    }

    return sendResponse(res, 200, "Match complete", {
      matched,
      notMatched,
      matchedCount:    matched.length,
      notMatchedCount: notMatched.length,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * POST /callingData/:campaignId/applyCompanyExclusion
 * Body: { companyNames: string[], scope: "all" | "registered" }
 * Marks matching CallingData records as "Excluded".
 * scope="registered" → only contacts where isRegistered=true are excluded.
 * Returns: { excludedCount, totalContacts, remainingCount }
 */
const applyCompanyExclusion = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { companyNames, scope = "all" } = req.body;
    if (!campaignId) return sendError(next, "campaignId is required", 400);
    if (!Array.isArray(companyNames) || companyNames.length === 0)
      return sendError(next, "companyNames array is required", 400);

    const baseQuery = { CampaignId: campaignId };
    if (scope === "registered") baseQuery.isRegistered = true;

    // Reset any previous exclusions for this campaign+scope so re-uploads start fresh
    await CallingData.updateMany(
      { ...baseQuery, companyExcluded: true },
      { $set: { companyExcluded: false, companyExcludedAt: null } }
    );

    const totalContacts = await CallingData.countDocuments(baseQuery);

    const updateQuery = { ...baseQuery, Company_Name: { $in: companyNames } };

    const result = await CallingData.updateMany(updateQuery, {
      $set: {
        companyExcluded:   true,
        companyExcludedAt: new Date(),
      },
    });

    const remainingCount = await CallingData.countDocuments({
      ...baseQuery,
      companyExcluded: { $ne: true },
    });

    return sendResponse(res, 200, `${result.modifiedCount} contacts excluded`, {
      excludedCount:  result.modifiedCount,
      totalContacts,
      remainingCount,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * POST /callingData/:campaignId/assignExclusionPriority
 * Body: { scope: "all" | "registered", groupNo?: number, label?: string }
 * Assigns a priority group to all non-excluded, currently-unassigned contacts.
 * scope="registered" → only contacts where isRegistered=true.
 */
const assignExclusionPriority = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { scope = "all", groupNo, label, overwriteExisting = false } = req.body;
    if (!campaignId) return sendError(next, "campaignId is required", 400);

    // Determine group number
    let assignedNo = groupNo ? Number(groupNo) : null;
    if (!assignedNo || !Number.isInteger(assignedNo) || assignedNo <= 0) {
      const maxDoc = await CallingData.findOne(
        { CampaignId: campaignId, "priorityGroup.no": { $gt: 0 } },
        { "priorityGroup.no": 1 }
      ).sort({ "priorityGroup.no": -1 }).lean();
      assignedNo = (maxDoc?.priorityGroup?.no ?? 0) + 1;
    }
    const assignedLabel = (label && label.trim()) ? label.trim() : `P-${assignedNo}`;

    const query = { CampaignId: campaignId, companyExcluded: { $ne: true } };
    // If not overwriting, only assign contacts that don't yet have a priority group
    if (!overwriteExisting) query["priorityGroup.no"] = null;
    if (scope === "registered") query.isRegistered = true;

    const result = await CallingData.updateMany(query, {
      $set: {
        "priorityGroup.no":         assignedNo,
        "priorityGroup.label":      assignedLabel,
        "priorityGroup.assignedAt": new Date(),
      },
    });

    return sendResponse(res, 200, `Assigned ${assignedLabel} to ${result.modifiedCount} records`, {
      assignedCount: result.modifiedCount,
      no:            assignedNo,
      label:         assignedLabel,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export {
  uploadcallingData,
  getCallingDataById,
  editcallingData,
  addSingleContact,
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
  getDistinctFilterValues,
  deletePriorityGroup,
  swapPriorityGroups,
  getPrioritySlots,
  createPrioritySlot,
  deletePrioritySlotDef,
  externalUploadCallingData,
  downloadExternalUploadTemplate,
  resetNoResponseToYetToCall,
  reshuffleCallingData,
  getDistinctCampaignCompanies,
  matchCampaignCompanyNames,
  applyCompanyExclusion,
  assignExclusionPriority,
};
