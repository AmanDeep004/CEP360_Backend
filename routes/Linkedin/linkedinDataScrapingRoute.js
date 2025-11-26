import { Router } from "express";
import multer from "multer";
import { UserRoleEnum } from "../../utils/enum.js";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import { uploadProfiles } from "../../controllers/Linkedin/linkedinDataScrapingController.js";

const router = Router();
const { ADMIN, DATABASE_MANAGER } = UserRoleEnum;

const upload = multer({ storage: multer.memoryStorage() });

// router.post(
//   "/upload-linkedin-csv",
//   upload.single("file"),
//   protect,
//   authorize(DATABASE_MANAGER),
//   uploadProfiles
// );

router.post(
  "/upload-linkedin-csv",
  protect,
  upload.single("file"),
  uploadProfiles
);

export default router;
