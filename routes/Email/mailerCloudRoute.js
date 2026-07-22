import { Router } from "express";
import {
  getMailercloudTemplateByName,
  getAllMailerCloudTemplates,
  mailercloudWebhook,
  sendTemplateEmailToCallingData,
  getMailerCloudSenders,
} from "../../controllers/Email/mailerCloudController.js";
import { protect } from "../../middleware/authMiddleware.js";

const router = Router();

// router.post("/send-batch", sendBatchEmails);
// router.post("/send-template-email", sendEmailUsingTemplate);
router.post("/sendEmailWithTemplate", protect, sendTemplateEmailToCallingData);
router.post("/webhook", mailercloudWebhook);
router.get("/webhook", (req, res) =>
  res
    .status(200)
    .json({ status: "ok", message: "MailerCloud webhook endpoint active" })
);
router.get("/template", protect, getMailercloudTemplateByName);
router.get("/templates", protect, getAllMailerCloudTemplates);
router.get("/senders", protect, getMailerCloudSenders);
// router.get(
//   "/GetEmailStatus",
//   protect,
//   authorize(ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, RESOURCE_MANAGER, AGENT),
//   getAllEmailWebhookStatus
// );

export default router;
