import { Router } from "express";
import {
  getAllTemplates,
  sendTemplateMessage,
  sendBulkMessages,
} from "../../controllers/Whatsapp/whatsappController.js";

const router = Router();

router.get("/getAllWhatsappTemplates", getAllTemplates);
router.post("/sendTemplateMessage", sendTemplateMessage);

export default router;
