import { Router } from "express";
const router = Router();
import {
  dashboardData,
  getAllAgentsDashboardData,
  getAllAgentsStatsReport,
  getCombinedReport,
  getRegisteredUsersWithCampaign,
  getCallHistoryReport,
  getHourlyAnalysis,
} from "../controllers/dashboardController.js";
import { protect } from "../middleware/authMiddleware.js";

router.get("/dashboardData", protect, dashboardData);
router.get("/allAgentsReportData", protect, getAllAgentsDashboardData);
router.get("/allAgentsStatsReport", protect, getAllAgentsStatsReport);
router.get("/registeredUsersReport", protect, getRegisteredUsersWithCampaign);
router.get("/combinedReport", protect, getCombinedReport);
router.get("/callHistoryReport/:pmId", protect, getCallHistoryReport);
router.get("/hourlyAnalysis", protect, getHourlyAnalysis);

export default router;
