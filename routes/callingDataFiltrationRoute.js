import { Router } from "express";
import {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
  assignCallingDataToCampaign,
} from "../controllers/callingDataFiltrationController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT } = UserRoleEnum;
const router = Router();

router.get(
  "/getCampaignFilters/:campaignId",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER, AGENT),
  getCampaignFiltersByCampaignId
);

router.get(
  "/getPrevCampFiltersByCampaignId/:campaignId",
  protect,
  // authorize(ADMIN, PRESALES_MANAGER),
  getPrevCampFiltersByCampaignId
);

router.post(
  "/callingDataFilter",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  callingDataFilter
);

router.post(
  "/callingDataFilterLight",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  callingDataFilterLightweight
);
router.post(
  "/assignCallingDataToCampaign",
  protect,
  assignCallingDataToCampaign
);

export default router;
