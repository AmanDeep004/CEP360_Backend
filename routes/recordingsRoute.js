import { Router } from "express";
import { getRecordings } from "../controllers/recordingsController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, RESOURCE_MANAGER, PRESALES_MANAGER, PROGRAM_MANAGER } = UserRoleEnum;

// GET /api/recordings        — all recordings grouped by month → campaign
// GET /api/recordings?month=2026-08
// GET /api/recordings?campaign=Dell
// GET /api/recordings?flat=true
router.get("/", protect, authorize(ADMIN, RESOURCE_MANAGER, PRESALES_MANAGER, PROGRAM_MANAGER), getRecordings);

export default router;
