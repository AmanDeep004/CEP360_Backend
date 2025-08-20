import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import AgentAssigned from "../models/agentAssigned.js";
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
 * @desc    Create new campaign
 * @route   POST /api/campaigns
 * @access  Private/Admin/Program Manager
 */

const createCampaign = asyncHandler(async (req, res, next) => {
  try {
    const {
      name,
      type,
      category,
      startDate,
      endDate,
      programManager,
      status,
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      registrationTarget,
      attendeeTarget,
      eventTopic,
      hasTargetAccountList,
      targetDatabaseSize,
      targetCompanyIndustry,
      targetCity,
      targetCompanySize,
      jobTitles,
      jobFunctions,
      comments,
      clientDataType,
    } = req.body;

    // Check for duplicate name
    const campaignExists = await Campaign.exists({ name: name.trim() });

    if (campaignExists) {
      return sendError(next, "Campaign with this name already exists", 400);
    }

    // Create new campaign
    const campaign = await Campaign.create({
      name: name.trim(),
      type,
      category,
      startDate,
      endDate,
      programManager,
      status: status || "active",
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      registrationTarget,
      attendeeTarget,
      eventTopic,
      hasTargetAccountList,
      targetDatabaseSize,
      targetCompanyIndustry,
      targetCity,
      targetCompanySize,
      jobTitles,
      jobFunctions,
      comments,
      clientDataType,
    });

    return sendResponse(res, 200, "Campaign created successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const createCampaign_not_use = asyncHandler(async (req, res, next) => {
  try {
    const {
      name,
      type,
      startDate,
      endDate,
      programManager,
      status,
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      comments,
    } = req.body;
    const campaignExists = await Campaign.exists({ name: name.trim() });

    if (campaignExists) {
      return sendError(next, "Campaign with this name already exists", 400);
    }

    const campaign = await Campaign.create({
      name: name.trim(),
      type,
      startDate,
      endDate,
      programManager,
      status: status || "active",
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      comments,
    });
    // const populatedCampaign = await Campaign.findById(campaign._id)
    //   .populate({
    //     path: "programManager",
    //     select: "employeeName email",
    //   })
    //   .populate({
    //     path: "resourcesAssigned",
    //     select: "employeeName email role",
    //   })
    //   .populate({
    //     path: "resourcesReleased",
    //     select: "employeeName email role",
    //   });

    return sendResponse(res, 200, "Campaign created successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all campaigns
 * @route   GET /api/campaigns
 * @access  Private
 */
const getAllCampaigns = asyncHandler(async (req, res, next) => {
  try {
    const campaigns = await Campaign.find()
      .populate({
        path: "programManager",
        select: "employeeName email",
      })
      .lean();
    return sendResponse(
      res,
      200,
      "Campaigns retrieved successfully",
      campaigns
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get single campaign
 * @route   GET /api/campaigns/:id
 * @access  Private
 */
const getCampaign = asyncHandler(async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate({
        path: "programManager",
        select: "employeeName email",
      })
      .lean();

    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    return sendResponse(res, 200, "Campaign retrieved successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Update campaign
 * @route   PUT /api/campaigns/:id
 * @access  Private/Admin/Program Manager
 */
const updateCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { _id, ...updateData } = req.body;
    console.log("Update Data:", updateData);

    const updatedCampaign = await Campaign.findByIdAndUpdate(_id, updateData, {
      new: true,
      runValidators: true,
    }).populate({ path: "programManager", select: "employeeName email role" });
    console.log("Updated Campaign:", updatedCampaign);

    if (!updatedCampaign) return sendError(next, "Campaign not found", 404);

    return sendResponse(
      res,
      200,
      "Campaign updated successfully",
      updatedCampaign.toObject()
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
/**
 * @desc    Get campaigns by user ID with role-based access
 * @route   GET /api/campaigns/user/:userId
 * @access  Private
 */
const getCampaignsByUserIdold = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select("role");
    if (!user) return sendError(next, "User not found", 404);

    let query = {};
    switch (user.role) {
      case PROGRAM_MANAGER:
        query = { programManager: user._id };
        break;
      case AGENT:
        query = {
          $or: [
            { resourcesAssigned: user._id },
            { resourcesReleased: user._id },
          ],
        };
        break;
      case PRESALES_MANAGER:
      case RESOURCE_MANAGER:
      case DATABASE_MANAGER:
      case ADMIN:
        break;
      default:
        return sendError(next, "Invalid user role", 400);
    }

    const campaigns = await Campaign.find(query)
      .populate({ path: "programManager", select: "employeeName email role" })
      .lean();

    return sendResponse(
      res,
      200,
      "Campaigns retrieved successfully",
      campaigns
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const getCampaignsByUserId = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select("role");
    if (!user) return sendError(next, "User not found", 404);

    let campaigns = [];

    switch (user.role) {
      case PROGRAM_MANAGER:
        campaigns = await Campaign.find({ programManager: user._id })
          .populate({
            path: "programManager",
            select: "employeeName email role",
          })
          .sort({ createdAt: 1 }) // Sort by creation date, earliest first
          .lean();
        break;

      case AGENT:
        // Get all campaign assignments for this agent
        const agentAssignments = await AgentAssigned.find({
          agent_id: user._id,
        })
          .populate({
            path: "campaign_id",
            populate: {
              path: "programManager",
              select: "employeeName email role",
            },
          })
          .sort({ assigned_date: 1 }) // Sort by assignment date, earliest first
          .lean();

        // Extract unique campaigns and remove null/undefined campaigns
        const campaignMap = new Map();

        agentAssignments.forEach((assignment) => {
          if (assignment.campaign_id && assignment.campaign_id._id) {
            const campaignId = assignment.campaign_id._id.toString();

            // Only add if not already in map (keeps the earliest assignment)
            if (!campaignMap.has(campaignId)) {
              campaignMap.set(campaignId, {
                ...assignment.campaign_id,
                assignmentDetails: {
                  isAssigned: assignment.isAssigned,
                  assigned_date: assignment.assigned_date,
                  released_date: assignment.released_date,
                },
              });
            }
          }
        });

        // Convert map to array
        campaigns = Array.from(campaignMap.values());
        break;

      case PRESALES_MANAGER:
      case RESOURCE_MANAGER:
      case DATABASE_MANAGER:
      case ADMIN:
        // These roles can see all campaigns
        campaigns = await Campaign.find({})
          .populate({
            path: "programManager",
            select: "employeeName email role",
          })
          .sort({ createdAt: 1 }) // Sort by creation date, earliest first
          .lean();
        break;

      default:
        return sendError(next, "Invalid user role", 400);
    }

    return sendResponse(
      res,
      200,
      "Campaigns retrieved successfully",
      campaigns
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
/**
 * @desc    Delete campaign
 * @route   DELETE /api/campaigns/:id
 * @access  Private/Admin
 */
const deleteCampaign = asyncHandler(async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    await campaign.deleteOne();

    return sendResponse(res, 200, "Campaign deleted successfully", null);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  createCampaign,
  getAllCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignsByUserId,
};
