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
  getAdminHourlyAnalysis,
  getPMCampaignReport,
} from "../controllers/dashboardController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, SUPERADMIN, MIS_MANAGER } = UserRoleEnum;

router.get("/dashboardData", protect, dashboardData);
router.get("/allAgentsReportData", protect, getAllAgentsDashboardData);
router.get("/allAgentsStatsReport", protect, getAllAgentsStatsReport);
router.get("/registeredUsersReport", protect, getRegisteredUsersWithCampaign);
router.get("/combinedReport", protect, getCombinedReport);
router.get("/callHistoryReport/:pmId", protect, getCallHistoryReport);
router.get("/hourlyAnalysis", protect, getHourlyAnalysis);
router.get("/adminHourlyAnalysis",  protect, authorize(ADMIN, SUPERADMIN, MIS_MANAGER), getAdminHourlyAnalysis);
router.get("/pmCampaignReport",     protect, authorize(ADMIN, SUPERADMIN, MIS_MANAGER), getPMCampaignReport);

export default router;
