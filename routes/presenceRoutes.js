import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  heartbeat,
  getTeamPresence,
  getSettings,
  updateSettings,
  pmOverride,
  getAttendance,
} from "../controllers/presenceController.js";

const router = express.Router();

const { AGENT, PROGRAM_MANAGER, ADMIN, RESOURCE_MANAGER } = UserRoleEnum;

// Agent → ping every 30s
router.post("/heartbeat", protect, authorize(AGENT), heartbeat);

// PM → live team presence
router.get("/team", protect, authorize(PROGRAM_MANAGER, ADMIN, RESOURCE_MANAGER), getTeamPresence);

// Settings — GET: PM/RM/Admin can read; PUT: RM/Admin only
router.get("/settings", protect, authorize(PROGRAM_MANAGER, ADMIN, RESOURCE_MANAGER), getSettings);
router.put("/settings", protect, authorize(ADMIN, RESOURCE_MANAGER), updateSettings);

// PM/RM → manual time override
router.post("/override", protect, authorize(PROGRAM_MANAGER, ADMIN, RESOURCE_MANAGER), pmOverride);

// PM → attendance history
router.get("/attendance", protect, authorize(PROGRAM_MANAGER, ADMIN, RESOURCE_MANAGER), getAttendance);

export default router;
