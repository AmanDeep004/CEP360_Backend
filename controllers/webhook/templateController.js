// controllers/templateController.js
import Template from "../../models/Webhook/templateModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const createTemplate = asyncHandler(async (req, res, next) => {
  const { templateName, templateId, campaignId } = req.body;

  if (!templateName || !templateId) {
    return sendError(next, "TemplateName & templateId are required", 400);
  }

  const exists = await Template.findOne({ templateId });
  if (exists) return sendError(next, "Template Id already exists", 400);

  const newTemplate = await Template.create({
    templateName,
    templateId,
    campaignId,
  });

  return sendResponse(res, 200, "Template created successfully", newTemplate);
});

const getAllTemplates = asyncHandler(async (req, res, next) => {
  const templates = await Template.find().populate("campaignId").lean();

  return sendResponse(res, 200, "Templates fetched successfully", templates);
});

const updateTemplate = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { templateName, templateId, campaignId } = req.body;

  const updated = await Template.findByIdAndUpdate(
    id,
    { templateName, templateId, campaignId },
    { new: true }
  );

  if (!updated) return sendError(next, "Template not found", 404);

  return sendResponse(res, 200, "Template updated successfully", updated);
});

export { createTemplate, getAllTemplates, updateTemplate };
