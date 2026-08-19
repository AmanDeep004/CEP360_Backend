/**
 * assetController.js
 * IT Administrator — Laptop/Asset management
 * Handles: CRUD, assign/release, history tracking, PM-wise consolidated report
 */

import AssetModel from "../models/assetModel.js";
import User from "../models/userModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

// ── Helpers ───────────────────────────────────────────────────────────────────

const getAsset = () => AssetModel();

const POPULATE_AGENT    = { path: "assignedAgent", select: "employeeName employeeCode email mobile" };
const POPULATE_PM       = { path: "associatedPM",  select: "employeeName email" };
const POPULATE_BY       = { path: "assignedBy",    select: "employeeName" };
const POPULATE_ADDED_BY = { path: "addedBy",       select: "employeeName" };

// ── GET /asset  — list with filters & pagination ──────────────────────────────
export const getAssets = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { status, pmId, search, page = 1, limit = 20 } = req.query;

    const filter = { isDeleted: { $ne: true } };
    if (status === "assigned" || status === "unassigned") filter.status = status;
    if (pmId) filter.associatedPM = pmId;
    if (search) {
      const re = new RegExp(search.trim(), "i");
      filter.$or = [
        { assetNo: re },
        { vendorName: re },
        { assetBrand: re },
        { assetModel: re },
        { assetSerialNumber: re },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Asset.countDocuments(filter);
    const assets = await Asset.find(filter)
      .populate(POPULATE_AGENT)
      .populate(POPULATE_PM)
      .populate(POPULATE_BY)
      .populate(POPULATE_ADDED_BY)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    return sendResponse(res, 200, "Assets fetched", {
      data:       assets,
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/stats  — counts ────────────────────────────────────────────────
export const getAssetStats = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const [total, assigned] = await Promise.all([
      Asset.countDocuments({ isDeleted: { $ne: true } }),
      Asset.countDocuments({ isDeleted: { $ne: true }, status: "assigned" }),
    ]);
    return sendResponse(res, 200, "Asset stats", {
      total,
      assigned,
      unassigned: total - assigned,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── POST /asset  — create ─────────────────────────────────────────────────────
export const createAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { assetNo, vendorName, assetBrand, assetModel, assetSerialNumber } = req.body;

    if (!assetSerialNumber?.trim()) return sendError(next, "Asset Serial Number is required", 400);

    const exists = await Asset.findOne({ assetSerialNumber: assetSerialNumber.trim() }).lean();
    if (exists) return sendError(next, "Asset Serial Number already exists", 400);

    const asset = await Asset.create({
      assetNo:           assetNo?.trim() || "",
      vendorName:        vendorName?.trim() || "",
      assetBrand:        assetBrand?.trim() || "",
      assetModel:        assetModel?.trim() || "",
      assetSerialNumber: assetSerialNumber.trim(),
      addedBy:           req.user._id,
    });

    return sendResponse(res, 201, "Asset created", asset);
  } catch (err) {
    if (err.code === 11000) return sendError(next, "Asset Serial Number already exists", 400);
    return sendError(next, err.message, 500);
  }
});

// ── PUT /asset/:id  — update details (not assignment) ────────────────────────
export const updateAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;
    const { assetNo, vendorName, assetBrand, assetModel, assetSerialNumber } = req.body;

    const asset = await Asset.findById(id);
    if (!asset) return sendError(next, "Asset not found", 404);

    // Check serial number uniqueness if changed
    if (assetSerialNumber !== undefined) {
      const sn = assetSerialNumber.trim();
      if (!sn) return sendError(next, "Asset Serial Number cannot be empty", 400);
      if (sn !== asset.assetSerialNumber) {
        const dup = await Asset.findOne({ assetSerialNumber: sn, _id: { $ne: id } }).lean();
        if (dup) return sendError(next, "Asset Serial Number already exists", 400);
      }
      asset.assetSerialNumber = sn;
    }

    if (assetNo    !== undefined) asset.assetNo    = assetNo.trim();
    if (vendorName !== undefined) asset.vendorName = vendorName.trim();
    if (assetBrand !== undefined) asset.assetBrand = assetBrand.trim();
    if (assetModel !== undefined) asset.assetModel = assetModel.trim();

    await asset.save();

    const populated = await Asset.findById(id)
      .populate(POPULATE_AGENT)
      .populate(POPULATE_PM)
      .lean();

    return sendResponse(res, 200, "Asset updated", populated);
  } catch (err) {
    if (err.code === 11000) return sendError(next, "Asset Serial Number already exists", 400);
    return sendError(next, err.message, 500);
  }
});

// ── DELETE /asset/:id  — soft delete (preserves history for recovery) ─────────
export const deleteAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;
    const { note } = req.body;

    const asset = await Asset.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!asset) return sendError(next, "Asset not found", 404);
    if (asset.status === "assigned")
      return sendError(next, "Cannot delete an assigned asset. Release it first.", 400);

    const itAdmin = await User.findById(req.user._id).select("employeeName").lean();

    asset.isDeleted  = true;
    asset.deletedAt  = new Date();
    asset.deletedBy  = req.user._id;
    asset.deleteNote = note?.trim() || "";

    asset.history.push({
      action:          "released",   // reuse released action type for schema compat
      performedBy:     req.user._id,
      performedByName: itAdmin?.employeeName || "IT Admin",
      note:            `[DELETED] ${note?.trim() || ""}`,
      timestamp:       new Date(),
    });

    await asset.save();
    return sendResponse(res, 200, "Asset deleted", { _id: id });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── PUT /asset/:id/restore  — undo a soft delete ──────────────────────────────
export const restoreAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;

    const asset = await Asset.findOne({ _id: id, isDeleted: true });
    if (!asset) return sendError(next, "Deleted asset not found", 404);

    const itAdmin = await User.findById(req.user._id).select("employeeName").lean();

    asset.isDeleted  = false;
    asset.deletedAt  = null;
    asset.deletedBy  = null;
    asset.deleteNote = "";

    asset.history.push({
      action:          "released",
      performedBy:     req.user._id,
      performedByName: itAdmin?.employeeName || "IT Admin",
      note:            "[RESTORED]",
      timestamp:       new Date(),
    });

    await asset.save();

    const populated = await Asset.findById(id)
      .populate(POPULATE_AGENT)
      .populate(POPULATE_PM)
      .populate(POPULATE_ADDED_BY)
      .lean();

    return sendResponse(res, 200, "Asset restored successfully", populated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── PUT /asset/:id/assign ─────────────────────────────────────────────────────
export const assignAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;
    const { agentId, pmId, note } = req.body;

    if (!agentId) return sendError(next, "agentId is required", 400);

    const asset = await Asset.findById(id);
    if (!asset) return sendError(next, "Asset not found", 404);
    if (asset.status === "assigned")
      return sendError(next, "Asset is already assigned. Release it first.", 400);

    // Fetch agent and pm details for history snapshot
    const [agent, pm, itAdmin] = await Promise.all([
      User.findById(agentId).select("employeeName employeeCode").lean(),
      pmId ? User.findById(pmId).select("employeeName").lean() : Promise.resolve(null),
      User.findById(req.user._id).select("employeeName").lean(),
    ]);

    if (!agent) return sendError(next, "Agent not found", 404);

    asset.status        = "assigned";
    asset.assignedAgent = agentId;
    asset.associatedPM  = pmId || null;
    asset.assignedBy    = req.user._id;
    asset.assignedAt    = new Date();

    asset.history.push({
      action:          "assigned",
      agent:           agentId,
      agentName:       agent.employeeName,
      agentCode:       agent.employeeCode || null,
      pm:              pmId || null,
      pmName:          pm?.employeeName || null,
      performedBy:     req.user._id,
      performedByName: itAdmin?.employeeName || "IT Admin",
      note:            note || "",
      timestamp:       new Date(),
    });

    await asset.save();

    const populated = await Asset.findById(id)
      .populate(POPULATE_AGENT)
      .populate(POPULATE_PM)
      .populate(POPULATE_BY)
      .lean();

    return sendResponse(res, 200, "Asset assigned successfully", populated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── PUT /asset/:id/release ────────────────────────────────────────────────────
export const releaseAsset = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;
    const { note } = req.body;

    const asset = await Asset.findById(id);
    if (!asset) return sendError(next, "Asset not found", 404);
    if (asset.status === "unassigned")
      return sendError(next, "Asset is not currently assigned", 400);

    const [prevAgent, itAdmin] = await Promise.all([
      asset.assignedAgent
        ? User.findById(asset.assignedAgent).select("employeeName employeeCode").lean()
        : Promise.resolve(null),
      User.findById(req.user._id).select("employeeName").lean(),
    ]);

    const prevPm = asset.associatedPM
      ? await User.findById(asset.associatedPM).select("employeeName").lean()
      : null;

    asset.history.push({
      action:          "released",
      agent:           asset.assignedAgent,
      agentName:       prevAgent?.employeeName || null,
      agentCode:       prevAgent?.employeeCode || null,
      pm:              asset.associatedPM,
      pmName:          prevPm?.employeeName || null,
      performedBy:     req.user._id,
      performedByName: itAdmin?.employeeName || "IT Admin",
      note:            note || "",
      timestamp:       new Date(),
    });

    asset.status        = "unassigned";
    asset.assignedAgent = null;
    asset.associatedPM  = null;
    asset.assignedBy    = null;
    asset.assignedAt    = null;

    await asset.save();

    const populated = await Asset.findById(id)
      .populate(POPULATE_AGENT)
      .populate(POPULATE_PM)
      .lean();

    return sendResponse(res, 200, "Asset released successfully", populated);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/:id/history ────────────────────────────────────────────────────
export const getAssetHistory = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { id } = req.params;
    const asset = await Asset.findById(id).select("assetNo history").lean();
    if (!asset) return sendError(next, "Asset not found", 404);
    return sendResponse(res, 200, "Asset history", {
      assetNo: asset.assetNo,
      history: (asset.history || []).slice().reverse(), // newest first
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/pm-report  — PM-wise consolidated count ────────────────────────
export const getPMReport = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const report = await Asset.aggregate([
      { $match: { status: "assigned", associatedPM: { $ne: null }, isDeleted: { $ne: true } } },
      {
        $group: {
          _id:   "$associatedPM",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from:         "users",
          localField:   "_id",
          foreignField: "_id",
          as:           "pmDetails",
        },
      },
      { $unwind: { path: "$pmDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id:            0,
          pmId:           "$_id",
          pmName:         "$pmDetails.employeeName",
          pmEmail:        "$pmDetails.email",
          assignedCount:  "$count",
        },
      },
      { $sort: { assignedCount: -1 } },
    ]);

    return sendResponse(res, 200, "PM report", { data: report });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/dropdown/agents — all agents (no campaign filter) ──────────────
export const getAgentsForAssignment = asyncHandler(async (req, res, next) => {
  try {
    const agents = await User.find({ role: "agent" })
      .select("employeeName employeeCode email mobile associatedProgramManager")
      .sort({ employeeName: 1 })
      .lean();
    return sendResponse(res, 200, "Agents", agents);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/dropdown/pms — all program managers ────────────────────────────
export const getPMsForAssignment = asyncHandler(async (req, res, next) => {
  try {
    const pms = await User.find({ role: "program_manager" })
      .select("employeeName email")
      .sort({ employeeName: 1 })
      .lean();
    return sendResponse(res, 200, "PMs", pms);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /asset/pm-report/:pmId  — agents with assets under one PM ─────────────
export const getPMAgents = asyncHandler(async (req, res, next) => {
  try {
    const Asset = getAsset();
    const { pmId } = req.params;

    const assets = await Asset.find({ status: "assigned", associatedPM: pmId, isDeleted: { $ne: true } })
      .populate({ path: "assignedAgent", select: "employeeName employeeCode email mobile" })
      .populate({ path: "assignedBy",    select: "employeeName" })
      .select("assetNo assetBrand assetModel assetSerialNumber assignedAgent assignedBy assignedAt")
      .lean();

    return sendResponse(res, 200, "PM agents with assets", { data: assets });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});
