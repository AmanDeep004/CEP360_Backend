import { Router } from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  generateReport,
  getAllReportHistory,
  getReportHistory,
  getReportById,
  getSharedReport,
  downloadReport,
} from "../controllers/campaignReportController.js";

const router = Router();
const { PROGRAM_MANAGER, MIS_MANAGER } = UserRoleEnum;

// ── Public (no auth) ────────────────────────────────────────────────────────
router.get("/shared/:token", getSharedReport);

// ── Program Manager + MIS Manager ──────────────────────────────────────────
router.post("/generate", protect, authorize(PROGRAM_MANAGER, MIS_MANAGER), generateReport);
router.get("/history", protect, authorize(PROGRAM_MANAGER, MIS_MANAGER), getAllReportHistory);
router.get("/history/:campaignId", protect, authorize(PROGRAM_MANAGER, MIS_MANAGER), getReportHistory);
router.get("/:reportId/download", protect, authorize(PROGRAM_MANAGER, MIS_MANAGER), downloadReport);
router.get("/:reportId", protect, authorize(PROGRAM_MANAGER, MIS_MANAGER), getReportById);

export default router;
