import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import { UserRoleEnum } from "../utils/enum.js";
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
      startDate,
      endDate,
      programManager,
      status,
      teamLeaderId,
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      comments,
      resourcesAssigned,
      resourcesReleased,
    } = req.body;
    const campaignExists = await Campaign.findOne({ name: name.trim() });

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
      teamLeaderId,
      keyAccountManager,
      jcNumber,
      brandName,
      clientName,
      clientEmail,
      clientContact,
      comments,
      resourcesAssigned,
      resourcesReleased,
    });
    const populatedCampaign = await Campaign.findById(campaign._id)
      .populate({
        path: "programManager",
        select: "employeeName email",
        transform: (doc) => ({
          programManagerName: doc.employeeName,
          programManagerEmail: doc.email,
        }),
      })
      .populate({
        path: "teamLeaderId",
        select: "employeeName email",
      })
      .populate({
        path: "resourcesAssigned",
        select: "employeeName email role",
      })
      .populate({
        path: "resourcesReleased",
        select: "employeeName email role",
      });

    return sendResponse(
      res,
      200,
      "Campaign created successfully",
      populatedCampaign
    );
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
      .populate({
        path: "teamLeaderId",
        select: "employeeName email",
      })
      .populate({
        path: "resourcesAssigned",
        select: "employeeName email role",
      })
      .populate({
        path: "resourcesReleased",
        select: "employeeName email role",
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
      .populate({
        path: "teamLeaderId",
        select: "employeeName email",
      })
      .populate({
        path: "resourcesAssigned",
        select: "employeeName email role",
      })
      .populate({
        path: "resourcesReleased",
        select: "employeeName email role",
      });

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
    const campaign = await Campaign.findById(req.body._id);

    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    // If name is being updated, check for uniqueness
    if (req.body.name) {
      const nameExists = await Campaign.findOne({
        name: req.body.name.trim(),
        _id: { $ne: req.body._id }, // Exclude current campaign
      });

      if (nameExists) {
        return sendError(next, "Campaign with this name already exists", 400);
      }
    }
    const updatedCampaign = await Campaign.findByIdAndUpdate(
      req.body._id,
      { ...req.body, name: req.body.name?.trim() },
      { new: true, runValidators: true }
    );

    return sendResponse(
      res,
      200,
      "Campaign updated successfully",
      updatedCampaign
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
const getCampaignsByUserId = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return sendError(next, "User not found", 404);
    }

    let query = {};
    let selectFields = {};

    // Set query based on user role
    switch (user.role) {
      case PROGRAM_MANAGER:
        query = { programManager: user._id };
        break;
      case PRESALES_MANAGER:
        // Resource managers can see all campaigns
        break;
      case AGENT:
        query = {
          $or: [
            { resourcesAssigned: user._id },
            { resourcesReleased: user._id },
          ],
        };
        // Limit fields for agents
        selectFields = {
          name: 1,
          type: 1,
          startDate: 1,
          endDate: 1,
          status: 1,
          programManager: 1,
          teamLeaderId: 1,
        };
        break;
      default:
        return sendError(next, "Invalid user role", 400);
    }

    const campaigns = await Campaign.find(query)
      .select(Object.keys(selectFields).length ? selectFields : null)
      .populate({
        path: "programManager",
        select: "employeeName email",
      })
      .populate({
        path: "teamLeaderId",
        select: "employeeName email",
      })
      .populate({
        path: "resourcesAssigned",
        select: "employeeName email role",
      })
      .populate({
        path: "resourcesReleased",
        select: "employeeName email role",
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
