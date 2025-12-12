import { Router } from "express";
import {
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

export default router;
