import { Router } from "express";
import {
  uploadcallingData,
  getCallingDataById,
  editcallingData,
  addSingleContact,
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
  getDistinctFilterValues,
  deletePriorityGroup,
  swapPriorityGroups,
  getPrioritySlots,
  createPrioritySlot,
  deletePrioritySlotDef,
  externalUploadCallingData,
  downloadExternalUploadTemplate,
  resetNoResponseToYetToCall,
  reshuffleCallingData,
  getDistinctCampaignCompanies,
  matchCampaignCompanyNames,
  applyCompanyExclusion,
  assignExclusionPriority,
} from "../controllers/callingDataController.js";
import {
  uploadExternalDataController,
  getAllExternalRegistrations,
  downloadExternalRegistrationTemplate,
} from "../controllers/externalRegistrationController.js";
import {
  downloadExternalCallingDataTemplate,
  uploadExternalCallingData,
} from "../controllers/externalCallingDataController.js";
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
router.post("/addContact", protect, addSingleContact);
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
router.post(
  "/reshuffleCallingData",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER),
  reshuffleCallingData
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

router.get(
  "/external-registration-template",
  protect,
  downloadExternalRegistrationTemplate
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
router.get("/:campaignId/distinctFilterValues",   protect, getDistinctFilterValues);
router.post("/:campaignId/assignPriorityGroup",   protect, assignPriorityGroup);
router.delete("/:campaignId/priorityGroup/:groupNo", protect, deletePriorityGroup);
router.patch("/:campaignId/swapPriorityGroups",   protect, swapPriorityGroups);

// ── Company exclusion ───────────────────────────────────────────────────────
router.get( "/:campaignId/distinctCompanies",      protect, getDistinctCampaignCompanies);
router.post("/:campaignId/matchCompanyNames",      protect, matchCampaignCompanyNames);
router.post("/:campaignId/applyCompanyExclusion",    protect, applyCompanyExclusion);
router.post("/:campaignId/assignExclusionPriority",  protect, assignExclusionPriority);

// ── Priority slot definitions (persisted) ──────────────────────────────────
router.get("/:campaignId/prioritySlots",          protect, getPrioritySlots);
router.post("/:campaignId/prioritySlots",         protect, createPrioritySlot);
router.delete("/:campaignId/prioritySlots/:no",   protect, deletePrioritySlotDef);

router.put("/resetNoResponse/:campaignId", protect, authorize(ADMIN, PROGRAM_MANAGER), resetNoResponseToYetToCall);

// ── External Calling Data Upload (presales) ──────────────────────────────────
router.get("/external-calling-data-template", protect, downloadExternalCallingDataTemplate);
router.post(
  "/external-calling-data-upload",
  protect,
  upload.single("file"),
  uploadExternalCallingData
);

export default router;
