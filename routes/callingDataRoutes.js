import { Router } from "express";
import {
  uploadcallingData,
  getCallingDataById,
  editcallingData,
  deletecallingData,
  getAllCallingData,
  getDatabaseByAssignment,
  assignCallingDataToAgents,
  unassignCallingDataFromAgents,
  reassignCallingDatatoAgents,
  UpdateCallingData,
  getDatabaseByAssignmentUnmasked,
  setPriority,
  getPriorityList,
  closePriority,
  priorityFilterOptions,
  priorityPreview,
  assignPriorityGroup,
  getPriorityGroups,
  deletePriorityGroup,
  swapPriorityGroups,
  getPrioritySlots,
  createPrioritySlot,
  deletePrioritySlotDef,
  externalUploadCallingData,
  downloadExternalUploadTemplate,
} from "../controllers/callingDataController.js";
import {
  uploadExternalDataController,
  getAllExternalRegistrations,
} from "../controllers/externalRegistrationController.js";
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
router.get("/getCallingDataById/:id", protect, getCallingDataById);
router.put("/", protect, editcallingData);
router.post("/assignCallingDataToAgents", protect, assignCallingDataToAgents);
router.post(
  "/reassignCallingDatatoAgents",
  protect,
  reassignCallingDatatoAgents
);
router.post(
  "/unassignCallingDataFromAgents",
  protect,
  unassignCallingDataFromAgents
);
router.delete("/:id", protect, deletecallingData);
router.get("/getAllCallingData/:CampaignId", protect, getAllCallingData);
router.get("/campaignDataByAssignment/:CampaignId", protect, getDatabaseByAssignment);
router.get(
  "/campaignDataByAssignmentUnmasked/:CampaignId",
  protect,
  getDatabaseByAssignmentUnmasked
);
router.put("/updateCallingData", protect, UpdateCallingData);

// to track external data registration
router.post(
  "/externalRegistrationData",
  protect,
  upload.single("file"),
  uploadExternalDataController
);

router.get(
  "/getAllExternalRegistrations/:CampaignId",
  protect,
  getAllExternalRegistrations
);

// ── External Upload ─────────────────────────────────────────────────────────
router.get(
  "/external-upload-template",
  protect,
  downloadExternalUploadTemplate
);

router.post(
  "/external-upload",
  protect,
  upload.single("file"),
  externalUploadCallingData
);

// here  need to add filter based  calling data as well
// get all non assigned calling data

router.put("/setPriority/:id", protect, setPriority);
router.get("/getPriorityList/:agentId", protect, getPriorityList);
router.put("/closePriority/:id", protect, closePriority);

// ── Campaign-level priority groups (presales) ──────────────────────────────
router.get("/:campaignId/priorityFilterOptions", protect, priorityFilterOptions);
router.get("/:campaignId/priorityPreview",        protect, priorityPreview);
router.get("/:campaignId/priorityGroups",         protect, getPriorityGroups);
router.post("/:campaignId/assignPriorityGroup",   protect, assignPriorityGroup);
router.delete("/:campaignId/priorityGroup/:groupNo", protect, deletePriorityGroup);
router.patch("/:campaignId/swapPriorityGroups",   protect, swapPriorityGroups);

// ── Priority slot definitions (persisted) ──────────────────────────────────
router.get("/:campaignId/prioritySlots",          protect, getPrioritySlots);
router.post("/:campaignId/prioritySlots",         protect, createPrioritySlot);
router.delete("/:campaignId/prioritySlots/:no",   protect, deletePrioritySlotDef);

export default router;
