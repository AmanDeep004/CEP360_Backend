import { Router } from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  assignAgentsToCampaign,
  getAllAgents,
  getAllAgentsByCampaignId,
  releaseMultipleAgents,
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
router.get("/all-agents", protect, getAllAgents);
router.put("/release-agents", protect, releaseMultipleAgents);

export default router;
