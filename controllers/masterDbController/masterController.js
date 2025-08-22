import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import DndDetail from "../../models/MasterDBModel/dndModel.js";
import EngagementHistory from "../../models/MasterDBModel/enagagementHistoryModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const createData = asyncHandler(async (req, res, next) => {
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      return sendError(next, "Type and data are required", 400);
    }

    let model;
    switch (type) {
      case "company":
        model = Company;
        break;
      case "contact":
        model = Contact;
        break;
      case "dnd":
        model = DndDetail;
        break;
      case "engagement":
        model = EngagementHistory;
        break;
      default:
        return sendError(next, "Invalid type", 400);
    }

    // Bulk insert optimization
    const inserted = Array.isArray(data)
      ? await model.insertMany(data, { ordered: false })
      : await model.create(data);

    return sendResponse(res, 201, "Data inserted successfully", inserted);
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

/**
 * ==============================
 * GET ALL (with pagination + filters)
 * ==============================
 */
const getAllData = asyncHandler(async (req, res, next) => {
  try {
    const { type } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500); // safety cap
    const skip = (page - 1) * limit;

    let model;
    switch (type) {
      case "company":
        model = Company;
        break;
      case "contact":
        model = Contact;
        break;
      case "dnd":
        model = DndDetail;
        break;
      case "engagement":
        model = EngagementHistory;
        break;
      default:
        return sendError(next, "Invalid type", 400);
    }

    // Build filter dynamically (if any query params provided)
    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;

    const [total, data] = await Promise.all([
      model.countDocuments(filters),
      model.find(filters).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, `${type} fetched successfully`, {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

/**
 * ==============================
 * GET by ID
 * ==============================
 */
const getDataById = asyncHandler(async (req, res, next) => {
  try {
    const { type, id } = req.params;

    let model;
    switch (type) {
      case "company":
        model = Company;
        break;
      case "contact":
        model = Contact;
        break;
      case "dnd":
        model = DndDetail;
        break;
      case "engagement":
        model = EngagementHistory;
        break;
      default:
        return sendError(next, "Invalid type", 400);
    }

    const item = await model.findById(id).lean();
    if (!item) return sendError(next, `${type} not found`, 404);

    return sendResponse(res, 200, `${type} fetched successfully`, item);
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

/**
 * ==============================
 * DELETE by ID
 * ==============================
 */
const deleteDataById = asyncHandler(async (req, res, next) => {
  try {
    const { type, id } = req.params;

    let model;
    switch (type) {
      case "company":
        model = Company;
        break;
      case "contact":
        model = Contact;
        break;
      case "dnd":
        model = DndDetail;
        break;
      case "engagement":
        model = EngagementHistory;
        break;
      default:
        return sendError(next, "Invalid type", 400);
    }

    const deleted = await model.findByIdAndDelete(id);
    if (!deleted) return sendError(next, `${type} not found`, 404);

    return sendResponse(res, 200, `${type} deleted successfully`, deleted);
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

export { createData, getAllData, getDataById, deleteDataById };
