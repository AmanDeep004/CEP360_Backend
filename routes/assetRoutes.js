import { Router } from "express";
import {
  getAssets,
  getAssetStats,
  createAsset,
  updateAsset,
  deleteAsset,
  assignAsset,
  releaseAsset,
  getAssetHistory,
  getPMReport,
  getPMAgents,
  getAgentsForAssignment,
  getPMsForAssignment,
} from "../controllers/assetController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { IT_ADMINISTRATOR, SUPERADMIN } = UserRoleEnum;
const IT_ROLES = [IT_ADMINISTRATOR, SUPERADMIN];

// Stats
router.get("/stats",          protect, authorize(...IT_ROLES), getAssetStats);

// PM consolidated report
router.get("/pm-report",      protect, authorize(...IT_ROLES), getPMReport);
router.get("/pm-report/:pmId",protect, authorize(...IT_ROLES), getPMAgents);

// Dropdown data for assign modal
router.get("/dropdown/agents", protect, authorize(...IT_ROLES), getAgentsForAssignment);
router.get("/dropdown/pms",    protect, authorize(...IT_ROLES), getPMsForAssignment);

// Asset CRUD
router.get("/",               protect, authorize(...IT_ROLES), getAssets);
router.post("/",              protect, authorize(...IT_ROLES), createAsset);
router.put("/:id",            protect, authorize(...IT_ROLES), updateAsset);
router.delete("/:id",         protect, authorize(...IT_ROLES), deleteAsset);

// Assignment
router.put("/:id/assign",     protect, authorize(...IT_ROLES), assignAsset);
router.put("/:id/release",    protect, authorize(...IT_ROLES), releaseAsset);

// History
router.get("/:id/history",    protect, authorize(...IT_ROLES), getAssetHistory);

export default router;
