import { Router } from "express";
import {
  createCampaign,
  getAllCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignsByUserId,
  uploadCampaignDatabase,
} from "../controllers/campaignController.js";
import multer from "multer";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
const upload = multer({ storage: multer.memoryStorage() });

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT } = UserRoleEnum;
const router = Router();

// Create new campaign
router.post(
  "/create",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  createCampaign
);

// Get all campaigns
router.get(
  "/allCampaigns",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  getAllCampaigns
);

// Get single campaign by ID
router.get("/:id", protect, getCampaign);

// get campaign details by user id   only for pm/agent
router.get(
  "/getCampaignById/:userId",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER, AGENT),
  getCampaignsByUserId
);
// Update campaign
router.put(
  "/update",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  updateCampaign
);

router.post(
  "/upload-database",
  protect,
  upload.single("file"),
  uploadCampaignDatabase
);
// Delete campaign
// router.delete("/delete/:id", protect, authorize(ADMIN), deleteCampaign);

export default router;
