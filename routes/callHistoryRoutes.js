import { Router } from "express";
import {
  createCallHistory,
  updateCallHistory,
  getCallHistoryByCallingDataId,
  getCallHistoryByCampaignId,
} from "../controllers/callHistoryController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

router.post(
  "/create",
  // protect,
  // authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  createCallHistory
);

router.put(
  "/update/:id",
  //   protect,
  //   authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  updateCallHistory
);

// router.get(
//   "/call-history/:calling-data-id",
//   //   protect,
//   //   authorize(ADMIN, PROGRAM_MANAGER, AGENT),
//   updateCallHistory
// );

router.get(
  "/campaign/:campaignId",
  //protect,
  // authorize(ADMIN, PROGRAM_MANAGER, AGENT, PRESALES_MANAGER),
  getCallHistoryByCampaignId
);

router.get(
  "/calling-data/:callingDataId",
  // protect,
  // authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  getCallHistoryByCallingDataId
);
export default router;
