import Brand from "../../models/MasterDBModel/brandsWorkedWithModel.js";
import errorHandler from "../../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

/** GET /api/masterdb/brands — full list sorted by name */
export const getAllBrands = asyncHandler(async (req, res, next) => {
  try {
    const brands = await Brand.find({}).sort({ name: 1 }).lean();
    return sendResponse(res, 200, "Brands fetched", brands);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/** POST /api/masterdb/brands — add a new brand
 *  Body: { name, eventsCount?, addedBy? }
 *  Returns { alreadyExists: true } with 200 if duplicate, otherwise creates.
 */
export const addBrand = asyncHandler(async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) return sendError(next, "Brand name is required", 400);

    // Case-insensitive duplicate check
    const existing = await Brand.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    }).lean();

    if (existing) {
      return sendResponse(res, 200, "Brand already exists", {
        alreadyExists: true,
        brand: existing,
      });
    }

    const brand = await Brand.create({
      name,
      eventsCount: req.body.eventsCount || 0,
      addedBy:     req.body.addedBy || "",
    });

    return sendResponse(res, 201, "Brand added", { alreadyExists: false, brand });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
