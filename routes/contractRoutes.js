import { Router } from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  getExpiringContracts,
  getAllContracts,
  getAgentContractHistory,
  getGlobalContractHistory,
  renewContract,
  rejectContract,
  endContract,
} from "../controllers/contractController.js";

const router = Router();
const { PROGRAM_MANAGER, RESOURCE_MANAGER, ADMIN, SUPERADMIN } = UserRoleEnum;
const ALL_AUTHORIZED = [PROGRAM_MANAGER, RESOURCE_MANAGER, ADMIN, SUPERADMIN];

router.get("/expiring",            protect, authorize(PROGRAM_MANAGER),  getExpiringContracts);
router.get("/history",             protect, authorize(RESOURCE_MANAGER, ADMIN, SUPERADMIN), getGlobalContractHistory);
router.get("/",                    protect, authorize(...ALL_AUTHORIZED), getAllContracts);
router.get("/:agentId/history",   protect, authorize(...ALL_AUTHORIZED), getAgentContractHistory);
router.put("/:agentId/renew",     protect, authorize(...ALL_AUTHORIZED), renewContract);
router.put("/:agentId/reject",    protect, authorize(...ALL_AUTHORIZED), rejectContract);
router.put("/:agentId/end",       protect, authorize(...ALL_AUTHORIZED), endContract);

export default router;
