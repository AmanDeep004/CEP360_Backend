import { Router } from "express";
import {
  uploadCampaignDatabase,
  editCampaignDatabase,
  deleteCampaignDatabase,
  getAllDatabaseByCampaignId,
} from "../controllers/campaignDataBaseController.js";
import multer from "multer";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
const upload = multer({ storage: multer.memoryStorage() });

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT } = UserRoleEnum;
const router = Router();
router.post(
  "/upload-database",
  protect,
  upload.single("file"),
  uploadCampaignDatabase
);

router.post(
  "/upload-database",
  protect,
  upload.single("file"),
  uploadCampaignDatabase
);
router.put("/:id", protect, editCampaignDatabase);
router.delete("/:id", protect, deleteCampaignDatabase);
router.get("/:CampaignId", protect, getAllDatabaseByCampaignId);

export default router;
