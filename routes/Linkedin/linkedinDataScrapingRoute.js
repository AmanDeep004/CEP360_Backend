import { Router } from "express";
import multer from "multer";
import { UserRoleEnum } from "../../utils/enum.js";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import { uploadProfiles } from "../../controllers/Linkedin/linkedinDataScrapingController.js";
import { getAllEnrichedProfiles } from "../../controllers/Linkedin/linkedinDataScrapingController.js";

const router = Router();
const { ADMIN, DATABASE_MANAGER } = UserRoleEnum;

const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/uploadLinkedinCsv",
  protect,
  upload.single("file"),
  uploadProfiles
);
router.get("/getAllEnrichedProfiles", protect, getAllEnrichedProfiles);

export default router;
