// controllers/templateController.js
import Template from "../../models/Webhook/templateModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const createTemplate = asyncHandler(async (req, res, next) => {
  const { templateName, templateId, campaignId, type } = req.body;

  if (!templateName) {
    return sendError(next, "TemplateName is required", 400);
  }

  const exists = await Template.findOne({ templateName });
  if (exists) return sendError(next, "Template Name already exists", 400);

  const newTemplate = await Template.create({
    templateName,
    templateId,
    campaignId,
    type,
  });

  return sendResponse(res, 200, "Template created successfully", newTemplate);
});

const getAllTemplates = asyncHandler(async (req, res, next) => {
  const templates = await Template.find()
    .populate("campaignId")
    .sort({ createdAt: -1 })
    .lean();

  return sendResponse(res, 200, "Templates fetched successfully", templates);
});

const updateTemplate = asyncHandler(async (req, res, next) => {
  const { templateName, campaignId, type } = req.body;

  const updated = await Template.findOneAndUpdate(
    { templateName },
    { campaignId },
    { type },
    { new: true }
  );

  if (!updated) return sendError(next, "Template not found", 404);

  return sendResponse(res, 200, "Template updated successfully", updated);
});

export { createTemplate, getAllTemplates, updateTemplate };
