import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

/**
 * @desc    Create new campaign
 * @route   POST /api/campaigns
 * @access  Private/Admin/Program Manager
 */
const createCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { name, type, startDate, endDate, campaignManagerId } = req.body;
    const campaignExists = await Campaign.findOne({ name: name.trim() });

    if (campaignExists) {
      return sendError(next, "Campaign with this name already exists", 400);
    }

    const campaign = await Campaign.create({
      name: name.trim(),
      type,
      startDate,
      endDate,
      campaignManagerId,
      status: "active",
    });

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
      .populate("campaignManagerId", "employeeName email")
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
    const campaign = await Campaign.findById(req.params.id).populate(
      "campaignManagerId",
      "employeeName email"
    );

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
        _id: { $ne: req.params.id }, // Exclude current campaign
      });

      if (nameExists) {
        return sendError(next, "Campaign with this name already exists", 400);
      }
    }
    const updatedCampaign = await Campaign.findByIdAndUpdate(
      req.params.id,
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
};
