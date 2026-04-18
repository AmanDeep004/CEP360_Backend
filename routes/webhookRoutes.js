import express from "express";
import {
  messageStatusUpdate,
  messageReceiveUpdate,
  getAllDoubleTickLogs,
  //  getAllEmailWebhookStatus,
} from "../controllers/webhook/webhookController.js";
import { telcmiWebhook } from "../controllers/callRecordingController.js";
import { tataSmartFloWebhook } from "../controllers/tataCallingController.js";
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
router.post("/messagestatusUpdate", messageStatusUpdate);
router.post("/messageReceiveUpdate", messageReceiveUpdate);

// wiza webhooks
router.post("/wiza", wizaWebhook);

// TeleCMI webhooks
router.post("/callReport", telcmiWebhook);

// Tata SmartFlo webhooks — configure this URL in Tata SmartFlo admin panel:
// https://<your-domain>/api/webhook/tataCallReport
router.post("/tataCallReport", tataSmartFloWebhook);

export default router;
