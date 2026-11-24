import { Router } from "express";
import multer from "multer";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
import {
  getBrands,
  downloadTemplate,
  uploadDncList,
  getDncList,
  removeDncEntry,
  clearDncForBrand,
  getDncIdsForCampaign,
} from "../controllers/dncController.js";

const { ADMIN, DATABASE_MANAGER, PRESALES_MANAGER } = UserRoleEnum;

const router  = Router();
const upload  = multer({ dest: "uploads/", limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

const allowed = [ADMIN, DATABASE_MANAGER, PRESALES_MANAGER];

router.get(    "/brands",         protect, authorize(...allowed), getBrands);
router.get(    "/template",       protect, authorize(...allowed), downloadTemplate);
router.post(   "/upload",         protect, authorize(...allowed), upload.single("file"), uploadDncList);
router.get(    "/list",           protect, authorize(...allowed), getDncList);
router.delete( "/remove/:id",     protect, authorize(...allowed), removeDncEntry);
router.delete( "/clear-brand",    protect, authorize(...allowed), clearDncForBrand);
router.get(    "/campaign-ids/:campaignId", protect, authorize(...allowed), getDncIdsForCampaign);

export default router;
