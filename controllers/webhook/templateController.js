// controllers/templateController.js
import Template from "../../models/Webhook/templateModel.js";
import Campaign from "../../models/campaignModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

// here
const createTemplate = asyncHandler(async (req, res, next) => {
  try {
    const { templateName, templateId, campaignId, type, senderEmail } =
      req.body;

    if (!templateName) {
      return sendError(next, "TemplateName is required", 400);
    }

    console.log("Creating template with data:", req.body);

    const exists = await Template.findOne({ templateName });
    if (exists) return sendError(next, "Template Name already exists", 400);

    const newTemplate = await Template.create({
      templateName,
      templateId,
      campaignId,
      type,
      senderEmail,
    });

    // Update campaign's senderEmail array if campaignId and senderEmail are provided
    if (campaignId && senderEmail) {
      await Campaign.findByIdAndUpdate(
        campaignId,
        {
          $push: {
            senderEmail: {
              email: senderEmail,
              timestamp: new Date(),
            },
          },
        },
        { new: true }
      );
    }

    return sendResponse(res, 200, "Template created successfully", newTemplate);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const getAllTemplates = asyncHandler(async (req, res, next) => {
  try {
    const templates = await Template.find()
      .populate("campaignId")
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(res, 200, "Templates fetched successfully", templates);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const updateTemplate = asyncHandler(async (req, res, next) => {
  try {
    const { templateName, campaignId, type, senderEmail } = req.body;

    const updated = await Template.findOneAndUpdate(
      { templateName },
      { campaignId, type, senderEmail },
      { new: true }
    );

    if (!updated) return sendError(next, "Template not found", 404);

    // Update campaign's senderEmail array if campaignId and senderEmail are provided
    if (campaignId && senderEmail) {
      await Campaign.findByIdAndUpdate(
        campaignId,
        {
          $push: {
            senderEmail: {
              email: senderEmail,
              timestamp: new Date(),
            },
          },
        },
        { new: true }
      );
    }

    return sendResponse(res, 200, "Template updated successfully", updated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { createTemplate, getAllTemplates, updateTemplate };
