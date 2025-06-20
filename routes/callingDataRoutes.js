import { Router } from "express";
import {
  uploadcallingData,
  editcallingData,
  deletecallingData,
  getAllCallingData,
} from "../controllers/callingDataController.js";
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
  uploadcallingData
);
router.put("/:id", protect, editcallingData);
router.delete("/:id", protect, deletecallingData);
router.get("/:CampaignId", protect, getAllCallingData);

export default router;
