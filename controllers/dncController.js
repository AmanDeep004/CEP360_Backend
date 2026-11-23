import mongoose from "mongoose";
import XLSX from "xlsx";
import fs from "fs";
import DncEntry from "../models/dncEntryModel.js";
import Company from "../models/MasterDBModel/companyModel.js";
import BrandsWorkedWith from "../models/MasterDBModel/brandsWorkedWithModel.js";
import utils from "../utils/index.js";

const { asyncHandler, sendResponse, sendError } = utils;

const CHUNK_SIZE = 500;

// ─────────────────────────────────────────────────────────────
// GET /api/dnc/brands
// Returns all brands from BrandsWorkedWith for the dropdown
// ─────────────────────────────────────────────────────────────
const getBrands = asyncHandler(async (req, res, next) => {
  const brands = await BrandsWorkedWith.find({})
    .select("_id name")
    .sort({ name: 1 })
    .lean();
  return sendResponse(res, 200, "Brands fetched", { brands });
});

// ─────────────────────────────────────────────────────────────
// GET /api/dnc/template
// Downloads an Excel template with the two accepted columns
// ─────────────────────────────────────────────────────────────
const downloadTemplate = asyncHandler(async (req, res, next) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { Company_Name: "Example Company Pvt Ltd", Company_Unique_ID: "" },
    { Company_Name: "",                        Company_Unique_ID: "60f1b2c3d4e5f6a7b8c9d0e1" },
  ]);
  // Column widths
  ws["!cols"] = [{ wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "DNC Template");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", 'attachment; filename="DNC_Upload_Template.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return res.send(buf);
});

// ─────────────────────────────────────────────────────────────
// POST /api/dnc/upload
// Parses uploaded Excel, resolves companies, inserts DNC entries.
// Returns JSON report: { success[], failed[], duplicate[] }
// Also upserts new brand into BrandsWorkedWith if it doesn't exist.
// ─────────────────────────────────────────────────────────────
const uploadDncList = asyncHandler(async (req, res, next) => {
  const { brandId, brandName } = req.body;
  if (!brandName || !brandName.trim()) {
    return sendError(next, "Brand name is required", 400);
  }
  if (!req.file) {
    return sendError(next, "Excel file is required", 400);
  }

  const resolvedBrandName = brandName.trim();

  // Upsert brand into BrandsWorkedWith (handles free-text new brands)
  const brandDoc = await BrandsWorkedWith.findOneAndUpdate(
    { name: resolvedBrandName },
    { $setOnInsert: { name: resolvedBrandName, eventsCount: 0 } },
    { upsert: true, new: true }
  );
  const resolvedBrandId = brandId || String(brandDoc._id);

  // Parse Excel
  let rows;
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return sendError(next, "Failed to parse Excel file. Ensure it is a valid .xlsx file.", 400);
  }
  fs.unlink(req.file.path, () => {});

  if (!rows || rows.length === 0) {
    return sendError(next, "Excel file is empty", 400);
  }

  const successRows  = [];
  const failedRows   = [];
  const duplicateRows = [];

  // Process in chunks of CHUNK_SIZE
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    // Collect IDs and names for bulk lookup
    const idLookups   = [];
    const nameLookups = [];

    for (const row of chunk) {
      const rawId   = String(row["Company_Unique_ID"] || "").trim();
      const rawName = String(row["Company_Name"]      || "").trim();
      if (rawId && mongoose.Types.ObjectId.isValid(rawId)) {
        idLookups.push({ rawId, rawName, row });
      } else if (rawName) {
        nameLookups.push({ rawName, row });
      } else {
        failedRows.push({
          Company_Name:      rawName || "—",
          Company_Unique_ID: rawId   || "—",
          Reason: "Both Company_Name and Company_Unique_ID are empty",
        });
      }
    }

    // Bulk fetch by ID
    const idMap = new Map();
    if (idLookups.length > 0) {
      const ids = idLookups.map((x) => new mongoose.Types.ObjectId(x.rawId));
      const companies = await Company.find({ _id: { $in: ids } })
        .select("_id Company_Name")
        .lean();
      for (const c of companies) idMap.set(String(c._id), c);
    }

    // Bulk fetch by name (exact, case-insensitive)
    const nameMap = new Map();
    if (nameLookups.length > 0) {
      const names = nameLookups.map((x) => x.rawName);
      const companies = await Company.find({
        Company_Name: { $in: names },
      })
        .select("_id Company_Name")
        .lean();
      for (const c of companies) nameMap.set(c.Company_Name, c);
    }

    // Build resolved list for this chunk
    const toInsert = [];
    for (const { rawId, rawName, row } of idLookups) {
      const company = idMap.get(rawId);
      if (!company) {
        failedRows.push({
          Company_Name:      rawName || "—",
          Company_Unique_ID: rawId,
          Reason: "No company found with this ID in MasterDB",
        });
      } else {
        toInsert.push({
          brandId:     resolvedBrandId,
          brandName:   resolvedBrandName,
          companyId:   String(company._id),
          companyName: company.Company_Name,
        });
      }
    }
    for (const { rawName, row } of nameLookups) {
      const company = nameMap.get(rawName);
      if (!company) {
        failedRows.push({
          Company_Name:      rawName,
          Company_Unique_ID: "—",
          Reason: "No exact match found in MasterDB companies",
        });
      } else {
        toInsert.push({
          brandId:     resolvedBrandId,
          brandName:   resolvedBrandName,
          companyId:   String(company._id),
          companyName: company.Company_Name,
        });
      }
    }

    // Bulk insert with duplicate handling
    if (toInsert.length > 0) {
      const ops = toInsert.map((entry) => ({
        updateOne: {
          filter: { companyId: entry.companyId, brandId: entry.brandId },
          update: {
            $setOnInsert: {
              companyId:   entry.companyId,
              companyName: entry.companyName,
              brandId:     entry.brandId,
              brandName:   entry.brandName,
              addedBy:     req.user.employeeName || req.user.name || String(req.user._id),
              isActive:    true,
            },
          },
          upsert: true,
        },
      }));

      const result = await DncEntry.bulkWrite(ops, { ordered: false });
      const insertedCount = result.upsertedCount || 0;
      const skippedCount  = toInsert.length - insertedCount;

      for (const entry of toInsert) {
        // We determine duplicate by checking if it already existed (not upserted)
        const wasUpserted = Object.values(result.upsertedIds || {}).some(
          (id) => id !== undefined
        );
        // Add to success or duplicate based on upsertedIds
        successRows.push({
          Company_Name:      entry.companyName,
          Company_Unique_ID: entry.companyId,
          Brand:             entry.brandName,
          Status:            "Added",
        });
      }

      // Re-check duplicates by querying existing active entries
      if (skippedCount > 0) {
        const companyIds = toInsert.map((e) => e.companyId);
        const existing = await DncEntry.find({
          companyId: { $in: companyIds },
          brandId:   resolvedBrandId,
          isActive:  true,
          createdAt: { $lt: new Date(Date.now() - 1000) }, // existed before this upload
        })
          .select("companyId companyName")
          .lean();
        const existingSet = new Set(existing.map((e) => e.companyId));
        // Fix success vs duplicate split
        for (let j = successRows.length - toInsert.length; j < successRows.length; j++) {
          const r = successRows[j];
          if (existingSet.has(r.Company_Unique_ID)) {
            duplicateRows.push({
              Company_Name:      r.Company_Name,
              Company_Unique_ID: r.Company_Unique_ID,
              Brand:             r.Brand,
              Status:            "Already in DNC list",
            });
            successRows.splice(j, 1);
            j--;
          }
        }
      }
    }
  }

  return sendResponse(res, 200, "DNC upload processed", {
    totalRows:      rows.length,
    successCount:   successRows.length,
    failedCount:    failedRows.length,
    duplicateCount: duplicateRows.length,
    success:        successRows,
    failed:         failedRows,
    duplicate:      duplicateRows,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/dnc/list?brandName=X&page=1&limit=50&search=Y
// Server-side paginated DNC list
// ─────────────────────────────────────────────────────────────
const getDncList = asyncHandler(async (req, res, next) => {
  const { brandName, search = "", page = 1, limit = 50 } = req.query;

  const filter = { isActive: true };
  if (brandName) filter.brandName = brandName;
  if (search.trim()) {
    filter.companyName = { $regex: search.trim(), $options: "i" };
  }

  const skip  = (parseInt(page) - 1) * parseInt(limit);
  const lim   = parseInt(limit);

  const [entries, total] = await Promise.all([
    DncEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .lean(),
    DncEntry.countDocuments(filter),
  ]);

  return sendResponse(res, 200, "DNC list fetched", {
    entries,
    total,
    page:       parseInt(page),
    totalPages: Math.ceil(total / lim),
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/dnc/remove/:id
// Soft-delete a single DNC entry
// ─────────────────────────────────────────────────────────────
const removeDncEntry = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return sendError(next, "Invalid DNC entry ID", 400);
  }
  const entry = await DncEntry.findByIdAndUpdate(
    id,
    { $set: { isActive: false } },
    { new: true }
  );
  if (!entry) return sendError(next, "DNC entry not found", 404);
  return sendResponse(res, 200, "DNC entry removed", {});
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/dnc/clear-brand?brandName=X
// Hard-deletes ALL DNC entries for the given brand
// ─────────────────────────────────────────────────────────────
const clearDncForBrand = asyncHandler(async (req, res, next) => {
  const { brandName } = req.query;
  if (!brandName || !brandName.trim()) {
    return sendError(next, "brandName is required", 400);
  }
  const result = await DncEntry.deleteMany({ brandName: brandName.trim() });
  return sendResponse(res, 200, "DNC entries cleared", { deletedCount: result.deletedCount });
});

// ─────────────────────────────────────────────────────────────
// Helper used by filter controllers — returns company ObjectIds
// to exclude for a given brandName. Returns [] if none.
// ─────────────────────────────────────────────────────────────
const getDncCompanyIdsForBrand = async (brandName) => {
  if (!brandName) return [];
  const entries = await DncEntry.find({ brandName, isActive: true })
    .select("companyId")
    .lean();
  if (entries.length === 0) return [];
  return entries
    .map((e) => {
      try { return new mongoose.Types.ObjectId(e.companyId); }
      catch { return null; }
    })
    .filter(Boolean);
};

export {
  getBrands,
  downloadTemplate,
  uploadDncList,
  getDncList,
  removeDncEntry,
  clearDncForBrand,
  getDncCompanyIdsForBrand,
};
