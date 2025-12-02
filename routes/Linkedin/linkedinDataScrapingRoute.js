import { Router } from "express";
import multer from "multer";
import { UserRoleEnum } from "../../utils/enum.js";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import {
  uploadProfiles,
  wizaWebhook,
} from "../../controllers/Linkedin/linkedinDataScrapingController.js";

const router = Router();
const { ADMIN, DATABASE_MANAGER } = UserRoleEnum;

const upload = multer({ storage: multer.memoryStorage() });

//route to upload the data
router.post(
  "/upload-linkedin-csv",
  protect,
  upload.single("file"),
  uploadProfiles
);

router.post("/wiza", protect, wizaWebhook);

export default router;
