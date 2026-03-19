import { Router } from "express";
import {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
  assignCallingDataToCampaign,
  companiesMatchedDataWithExcel,
  clientCallingDataFilter,
  assignCallingDataToCampaignClientSuggested,
  assignCallingDataToCampaignBoth,
  generateMagicLink,
  getSharedFilterStats,
  deactivateSharedLink,
  extendLinkExpiry,
  getClientMatchData,
  updateClientMatchAction,
} from "../controllers/callingDataFiltrationController.js";
import multer from "multer";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT } = UserRoleEnum;
const router = Router();
const upload = multer({ dest: "uploads/" });

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

router.post(
  "/companiesMatchedDataWithExcel",
  upload.single("file"),
  protect,
  companiesMatchedDataWithExcel
);

router.post(
  "/assignCallingDataToCampaignClientSuggested",
  protect,
  assignCallingDataToCampaignClientSuggested
);
router.post(
  "/assignCallingDataToCampaignBoth",
  protect,
  assignCallingDataToCampaignBoth
);

router.post("/clientCallingDataFilter", protect, clientCallingDataFilter);
router.get("/filterResultsSummary/:filterId", getSharedFilterStats);
router.post("/generate", protect, generateMagicLink);

router.patch("/:filterId/deactivate", protect, deactivateSharedLink);
router.patch("/:filterId/extend", protect, extendLinkExpiry);

router.get("/clientMatchData/:campaignId", protect, getClientMatchData);
router.patch("/clientMatchData/:campaignId/action", protect, updateClientMatchAction);

export default router;
