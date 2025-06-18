import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import CampaignDatabase from "../models/campaignDatabase.js";
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
 * @desc    Upload campaign database (Excel)
 * @route   POST /api/campaignDatabase/upload-database
 * @access  Private
 */

const uploadCampaignDatabase = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId, UploadedBy } = req.body;
    if (!req.file) return sendError(next, "No file uploaded", 400);

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    // const REQUIRED_FIELDS = ["Mobile_No"];
    const REQUIRED_FIELDS = [];

    const missingFields = REQUIRED_FIELDS.filter(
      (field) =>
        !Object.keys(json[0] || {})
          .map((f) => f.toLowerCase())
          .includes(field)
    );

    if (missingFields.length > 0) {
      return sendError(next, `Missing Fields: ${missingFields.join(",")}`, 400);
    }
    const dbEntries = json.map((row) => ({
      CampaignId,
      UploadedBy,
      Salutations: row.Salutations || "",
      // First_Name: row.First_Name || "",
      // Last_Name: row.Last_Name || "",
      Full_Name: row.Full_Name || "",
      Job_Title: row.Job_Title || "",
      Contact_City: row.Contact_City || "",
      Contact_State: row.Contact_State || "",
      Contact_Region: row.Contact_Region || "",
      Mobile_No: row.Mobile_No || null,
      Office_Email_1: row.Office_Email_1 || "",
      Office_Email_2: row.Office_Email_2 || "",
      Personal_Email1: row.Personal_Email1 || "",
      Personal_Email2: row.Personal_Email2 || "",
      Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile || "",
      Company_Name: row.Company_Name || "",
      Last_Engagement_Client_Name: row.Last_Engagement_Client_Name || "",
      Last_Engagement_Date: row.Last_Engagement_Date
        ? new Date(row.Last_Engagement_Date)
        : null,
      Last_Engagement_Campaign: row.Last_Engagement_Campaign || "",
      Last_Engagement_Type: row.Last_Engagement_Type || "",
    }));

    await CampaignDatabase.insertMany(dbEntries);

    return sendResponse(res, 200, "Database uploaded successfully", {
      count: dbEntries.length,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * @desc    Edit a campaign database entry
 * @route   PUT /api/campaignDatabase/:id
 * @access  Private
 */
const editCampaignDatabase = asyncHandler(async (req, res, next) => {
  try {
    const updatedEntry = await CampaignDatabase.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
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
 * @desc    Delete a campaign database entry
 * @route   DELETE /api/campaigns/database/:id
 * @access  Private
 */
const deleteCampaignDatabase = asyncHandler(async (req, res, next) => {
  try {
    const deletedEntry = await CampaignDatabase.findByIdAndDelete(
      req.params.id
    );
    if (!deletedEntry) {
      return sendError(next, "Entry not found", 404);
    }
    return sendResponse(res, 200, "Entry deleted successfully", deletedEntry);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * @desc    Get all campaign database entries by CampaignId (with pagination)
 * @route   GET /api/campaigns/database/:CampaignId
 * @access  Private
 * @query   page, limit
 */
const getAllDatabaseByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

    const [total, data] = await Promise.all([
      CampaignDatabase.countDocuments(filter),
      CampaignDatabase.find(filter).skip(skip).limit(limit).lean(),
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

export {
  uploadCampaignDatabase,
  editCampaignDatabase,
  deleteCampaignDatabase,
  getAllDatabaseByCampaignId,
};
