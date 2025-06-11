import { Router } from "express";
import {
  createCampaign,
  getAllCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
} from "../controllers/campaignController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER } = UserRoleEnum;
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

// Update campaign
router.put(
  "/update",
  protect,
  authorize(ADMIN, PRESALES_MANAGER, PROGRAM_MANAGER),
  updateCampaign
);

// Delete campaign
// router.delete("/delete/:id", protect, authorize(ADMIN), deleteCampaign);

export default router;
