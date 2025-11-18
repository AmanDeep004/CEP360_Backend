import express from "express";
import {
  messageStatusUpdate,
  messageReceiveUpdate,
} from "../controllers/webhook/webhookController.js";

const router = express.Router();

router.post("/MessagestatusUpdate", messageStatusUpdate);
router.post("/MessageReceiveUpdate", messageReceiveUpdate);

export default router;
