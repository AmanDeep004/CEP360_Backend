import { Router } from "express";
const router = Router();
import {
  dashboardData,
  getAllAgentsDashboardData,
} from "../controllers/dashboardController.js";
import { protect } from "../middleware/authMiddleware.js";

router.get("/dashboardData", protect, dashboardData);
router.get("/allAgentsReportData", protect, getAllAgentsDashboardData);

export default router;
