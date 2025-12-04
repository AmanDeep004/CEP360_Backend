import express from "express";
import {
  messageStatusUpdate,
  messageReceiveUpdate,
  getAllDoubleTickLogs,
} from "../controllers/webhook/webhookController.js";
import { wizaWebhook } from "../controllers/Linkedin/linkedinDataScrapingController.js";
import { UserRoleEnum } from "../utils/enum.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

const router = express.Router();
router.get(
  "/GetAllMailSentStatus",
  protect,
  authorize(ADMIN, PRESALES_MANAGER),
  getAllDoubleTickLogs
);
router.post("/MessagestatusUpdate", messageStatusUpdate);
router.post("/MessageReceiveUpdate", messageReceiveUpdate);

// wiza webhooks
router.post("/wiza", wizaWebhook);

export default router;
