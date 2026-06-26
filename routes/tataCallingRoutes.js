import { Router } from "express";
import {
  initiateCall,
  getLiveCalls,
  hangupCall,
  updateCallId,
  getCallStatus,
  getRecordingsByContact,
} from "../controllers/tataCallingController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { UserRoleEnum } from "../utils/enum.js";

const router = Router();
const { ADMIN, PROGRAM_MANAGER, AGENT } = UserRoleEnum;

// Initiate a click-to-call via the agent's SmartFlo extension
router.post("/call", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), initiateCall);

// Proxy Tata live_calls — frontend polls this to detect connection & remote hangup
router.get("/live", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), getLiveCalls);

// Hang up and mark call as completed
router.put("/hangup", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), hangupCall);

// Update resolved callId once live_calls returns it
router.patch("/updateCallId", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), updateCallId);

// Poll call status + recording URL after call ends
router.get("/status/:callId", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), getCallStatus);

// Fetch all recordings for a specific contact
router.get("/recordings/:callingDataId", protect, authorize(ADMIN, PROGRAM_MANAGER, AGENT), getRecordingsByContact);

export default router;
