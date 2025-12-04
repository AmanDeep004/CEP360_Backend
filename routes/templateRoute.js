import express from "express";
import {
  createTemplate,
  getAllTemplates,
  updateTemplate,
} from "../controllers/webhook/templateController.js";

import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

const router = express.Router();
router.get(
  "/getAllTemplateData",
  protect,
  authorize(ADMIN, PRESALES_MANAGER),
  getAllTemplates
);
router.post(
  "/createAndLinkTemplate",
  protect,
  authorize(ADMIN, PRESALES_MANAGER),
  createTemplate
);
router.put("/updateTemplate", updateTemplate);

export default router;
