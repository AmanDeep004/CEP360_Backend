import { Router } from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  assignAgentsToCampaign,
  getAllNonAssignedAgents,
  getAllAgentsByCampaignId,
  releaseMultipleAgents,
  getAllCampaignByAGentId,
  getCallingDataByAgentAndCampaign,
} from "../controllers/agentController.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

router.post("/assign-agents", protect, assignAgentsToCampaign);
router.get(
  "/agentlist-by-campaign/:campaignId",
  protect,
  getAllAgentsByCampaignId
);
router.get(
  "/getAllNonAssignedAgents/:campaignId",
  protect,
  getAllNonAssignedAgents
);
router.put("/release-agents", protect, releaseMultipleAgents);
router.get("/campaigns/:agentId", getAllCampaignByAGentId);
router.get("/:agentId/:campaignId", getCallingDataByAgentAndCampaign);
export default router;
