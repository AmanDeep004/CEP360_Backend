import { Router } from "express";
import multer from "multer";
import { protect, authorize } from "../../middleware/authMiddleware.js";
import { cache } from "../../middleware/cacheMiddleware.js";
import {
  getAllData,
  batchCreateFromExcel,
  getBatchJobStatus,
  updateData,
  getAllCompanyData,
  createANewCompany,
  getAllCompanyName,
  getDropdownFilters,
  getFiltersStats,
  getCompanyDataById,
  dumpAllHistoryData,
  migrateToEngagementHistory,
  getContactsWithEngagements,
} from "../../controllers/masterDbController/masterController.js";
import { UserRoleEnum } from "../../utils/enum.js";
const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB hard limit
});

// Multer error handler — returns clean JSON instead of crashing
const handleMulterError = (err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ success: false, message: "File too large. Maximum allowed size is 500 MB." });
  }
  next(err);
};

router.post(
  "/batchCreateFromExcel",
  // Per-route timeout: 10 minutes to handle slow large-file uploads
  (_req, res, next) => {
    res.setTimeout(600000);
    next();
  },
  upload.single("file"),
  handleMulterError,
  protect,
  batchCreateFromExcel
);
router.post("/AddNewCompany", protect, createANewCompany);
router.put("/update/:id", protect, updateData);
router.get("/getAllData", protect, getAllData);
router.get("/getCompanyDataById", protect, getCompanyDataById);
router.get("/getAllCompanyData", protect, getAllCompanyData);
router.get("/getAllCompanyName", protect, getAllCompanyName);
router.get("/getDropdownFilters", protect, cache(7200), getDropdownFilters);
router.get("/getFiltersStats", protect, getFiltersStats);
router.get("/getAllDumpHistoryData", dumpAllHistoryData);
router.get("/batchJobStatus/:jobId", protect, getBatchJobStatus);

router.get("/getContactsWithEngagements", protect, getContactsWithEngagements);
router.post(
  "/migrateToEngagementHistory/:campaignId",
  protect,
  migrateToEngagementHistory
);

export default router;
