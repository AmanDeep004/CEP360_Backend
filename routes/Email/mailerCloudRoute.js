import { Router } from "express";
import {
  getMailercloudTemplates,
  sendMailercloudEmail,
  sendBatchEmails,
  addEmailsToQueue,
  getQueueStatus,
} from "../../controllers/Email/mailerCloudController.js";

const router = Router();

// Get templates
router.get("/templates", getMailercloudTemplates);

// Send single email
router.post("/send", sendMailercloudEmail);

// 1️⃣ BATCH PROCESSING - Send multiple emails with rate limiting
router.post("/send-batch", sendBatchEmails);

// 2️⃣ QUEUE SYSTEM - Add emails to background queue
router.post("/queue/add", addEmailsToQueue);

// Get queue status
router.get("/queue/status", getQueueStatus);

export default router;
