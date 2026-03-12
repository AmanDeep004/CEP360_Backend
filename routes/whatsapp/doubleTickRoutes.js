import { Router } from "express";
import {
  getAllTemplates,
  sendTemplateMessage,
  sendBulkMessages,
} from "../../controllers/Whatsapp/whatsappController.js";
import { cache } from "../../middleware/cacheMiddleware.js";

const router = Router();

router.get("/getAllWhatsappTemplates", cache(300), getAllTemplates); // 5 min cache
router.post("/sendTemplateMessage", sendTemplateMessage);

export default router;
