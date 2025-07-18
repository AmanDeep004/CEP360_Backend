import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CallingData from "../models/callingDataModal.js";
import { UserRoleEnum } from "../utils/enum.js";
import XLSX from "xlsx";

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
      salutations: row.Salutations || "",
      full_Name: row.Full_Name,
      job_Title: row.Job_Title,
      company_Name: row.Company_Name,
      contact_City: row.Contact_City,
      contact_State: row.Contact_State || "",
      contact_Region: row.Contact_Region || "",
      mobile_No1: row.Mobile_No1,
      mobile_No2: row.Mobile_No2 || "",
      office_Email_1: row.Office_Email_1 || "",
      office_Email_2: row.Office_Email_2 || "",
      personal_Email1: row.Personal_Email1 || "",
      personal_Email2: row.Personal_Email2 || "",
      contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile || "",
      source: row.Source,
      batch: row.Batch || "",
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
 * @route PUT /api/callingData/:id
 * @access Private
 */
const editcallingData = asyncHandler(async (req, res, next) => {
  try {
    const updatedEntry = await CallingData.findByIdAndUpdate(
      req.body._id,
      req.body,
      { new: true, runValidators: true, lean: true }
    );
    if (!updatedEntry) {
      return sendError(next, "Entry not found", 404);
    }
    return sendResponse(res, 200, "Entry updated successfully", updatedEntry);
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
const getAllCallingDataold = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

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

const getAllCallingData = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

    // Search by full_Name only
    if (req.query.search && req.query.search.trim() !== "") {
      const searchRegex = new RegExp(`\\b${req.query.search.trim()}`, "i");
      filter.full_Name = searchRegex;
    }

    // Optional filter: isRegistered=true/false
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

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

    // Base filter
    const filter = { CampaignId };

    // 1) Assignment status
    if (assignment === "assigned") {
      filter.agentId = { $ne: null };
    } else if (assignment === "notassigned") {
      filter.agentId = null;
    }

    // 2) Assigned agent
    if (agentId) {
      filter.agentId = agentId;
    }

    // 3) Source (case-insensitive partial match)
    if (source) {
      filter.source = { $regex: new RegExp(source, "i") };
    }

    // Get all data first (filtered, before pagination)
    let fullQuery = CallingData.find(filter)
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

    let data = await fullQuery;

    // 4) Filter by remark (post-query)
    // if (remark) {
    //   data = data.filter((entry) => {
    //     const history = entry.callHistory?.chatHistory;
    //     return (
    //       Array.isArray(history) && history.some((c) => c.remarks === remark)
    //     );
    //   });
    // }
    if (remark) {
      data = data.filter((entry) => {
        const history = entry.callHistory?.chatHistory;
        const lastRemark =
          Array.isArray(history) && history[history.length - 1];
        return lastRemark?.remarks === remark;
      });
    }

    // 5) Apply range slicing after filtering
    if (range) {
      const parts = range.split("-").map((v) => parseInt(v.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => isNaN(n))) {
        return sendError(
          next,
          "Invalid range format. Use format like 100-200",
          400
        );
      }
      const [min, max] = parts;
      if (min > max) {
        return sendError(
          next,
          "Range minimum should be less than maximum",
          400
        );
      }

      // Slice based on index range (1-based range from UI, adjust to 0-based index)
      data = data.slice(min - 1, max);
    }

    const total = data.length;

    // 6) Apply pagination on the final filtered data
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

const assignCallingDataToAgents = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, callingDataIds, pmId, pmName } = req.body;

    if (
      !agentId ||
      !Array.isArray(callingDataIds) ||
      callingDataIds.length === 0 ||
      !pmId ||
      !pmName
    ) {
      return sendError(
        next,
        "AgentId,ProjectManager Id ,ProjectManager Name, CallingDataIds are required",
        400
      );
    }

    const result = await CallingData.updateMany(
      { _id: { $in: callingDataIds } },
      { $set: { agentId, pmId, pmName } }
    );

    return sendResponse(
      res,
      200,
      `${result.modifiedCount} calling data records updated successfully`,
      result
    );
  } catch (err) {
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

export {
  uploadcallingData,
  getCallingDataById,
  editcallingData,
  deletecallingData,
  getAllCallingData,
  getDatabaseByAssignment,
  assignCallingDataToAgents,
  unassignCallingDataFromAgents,
};
