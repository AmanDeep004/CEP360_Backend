import { Router } from "express";
import {
  createCallHistory,
  updateCallHistory,
  getAllCallHistoryByCallingDataId,
  proxyCallRecording,
} from "../controllers/callHistoryController.js";
import { createCallRecording } from "../controllers/callRecordingController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, PRESALES_MANAGER, AGENT, RESOURCE_MANAGER } =
  UserRoleEnum;

router.post(
  "/create",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  createCallHistory
);

router.put(
  "/update/:id",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  updateCallHistory
);

router.get(
  "/:callingDataId",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  getAllCallHistoryByCallingDataId
);

router.post("/createCallRecording", protect, createCallRecording);
router.get("/recording/proxy", protect, proxyCallRecording);
export default router;
