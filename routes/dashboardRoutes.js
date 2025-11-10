import { Router } from "express";
const router = Router();
import {
  dashboardData,
  getAllAgentsDashboardData,
  getAllAgentsStatsReport,
  getCombinedReport,
  getRegisteredUsersWithCampaign,
} from "../controllers/dashboardController.js";
import { protect } from "../middleware/authMiddleware.js";

router.get("/dashboardData", protect, dashboardData);
router.get("/allAgentsReportData", protect, getAllAgentsDashboardData);
router.get("/allAgentsStatsReport", getAllAgentsStatsReport);
router.get("/registeredUsersReport", getRegisteredUsersWithCampaign);
router.get("/combinedReport", getCombinedReport);

export default router;
