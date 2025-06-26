import { Router } from "express";
import {
  uploadcallingData,
  editcallingData,
  deletecallingData,
  getAllCallingData,
  getDatabaseByAssignment,
  assignCallingDataToAgents,
  unassignCallingDataFromAgents,
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
router.put("/", protect, editcallingData);
router.post("/assignCallingDataToAgents", protect, assignCallingDataToAgents);
router.post(
  "/unassignCallingDataFromAgents",
  protect,
  unassignCallingDataFromAgents
);
router.delete("/:id", protect, deletecallingData);
router.get("/getAllCallingData/:CampaignId", protect, getAllCallingData);
router.get("/campaignDataByAssignment/:CampaignId", getDatabaseByAssignment);

// here  need to add filter based  calling data as well
// get all non assigned calling data

export default router;
