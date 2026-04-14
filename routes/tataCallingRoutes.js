import { Router } from "express";
import {
  initiateCallRecord,
  updateCallId,
  hangupCallRecord,
  getCallStatus,
} from "../controllers/tataCallingController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, AGENT } = UserRoleEnum;

// Create initial call record when agent initiates a call
router.post(
  "/initiate",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  initiateCallRecord
);

// Update the record with the resolved call_id (from live_calls polling)
router.patch(
  "/updateCallId",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  updateCallId
);

// Mark call as completed when agent hangs up
router.put(
  "/hangup",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  hangupCallRecord
);

// Poll call status + recording URL (used by frontend after call ends)
router.get(
  "/status/:callId",
  protect,
  authorize(ADMIN, PROGRAM_MANAGER, AGENT),
  getCallStatus
);

export default router;
