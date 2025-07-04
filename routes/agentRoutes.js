import { Router } from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  assignAgentsToCampaign,
  getAllNonAssignedAgents,
  getAllAssignedAgents,
  getAllocAndUnalloclist,
  releaseAgents,
  getAllCampaignByAGentId,
  getCallingDataByAgentAndCampaign,
  getCallingDataByAgentData,
} from "../controllers/agentController.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

router.post("/assignAgents", protect, assignAgentsToCampaign);
router.get(
  "/getAllocAndUnalloclist/:campaignId",
  protect,
  getAllocAndUnalloclist
);
router.get(
  "/getAllNonAssignedAgents/:campaignId",
  protect,
  getAllNonAssignedAgents
);
router.get("/getAllAssignedAgents/:campaignId", protect, getAllAssignedAgents);
router.put("/releaseAgents", protect, releaseAgents);
router.get("/getCampaignByAgentId/:agentId", protect, getAllCampaignByAGentId);
router.get(
  "/getCallingDataByAgentIdAndCampaignId/:agentId/:campaignId",
  protect,
  getCallingDataByAgentAndCampaign
);
router.post(
  "/getCallingDataByAgent/:agentId",
  protect,
  getCallingDataByAgentData
);

export default router;
