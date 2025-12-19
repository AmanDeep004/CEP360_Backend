import { Router } from "express";
import {
  getAllEmailWebhookStatus,
  getMailercloudTemplateByName,
  mailercloudWebhook,
  //sendMailercloudEmail,
  sendTemplateEmailToCallingData,
} from "../../controllers/Email/mailerCloudController.js";

const router = Router();

// router.post("/send-batch", sendBatchEmails);
// router.post("/send-template-email", sendEmailUsingTemplate);
router.post("/sendEmailWithTemplate", sendTemplateEmailToCallingData);
router.post("/webhook", mailercloudWebhook);
router.get("/template", getMailercloudTemplateByName);
router.get(
  "/GetEmailStatus",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, RESOURCE_MANAGER, AGENT),
  getAllEmailWebhookStatus
);

export default router;
