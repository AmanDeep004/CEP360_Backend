import CallRecording from "../models/callRecordingModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

// ── POST /api/tataCalling/initiate ───────────────────────────────────────────
// Called by the frontend immediately after a successful click_to_call API call.
// Creates the initial CallRecording entry for tracking.
const initiateCallRecord = asyncHandler(async (req, res, next) => {
  try {
    const { callingData_id, contactNo, agent_id, agentName, callId } = req.body;

    if (!contactNo || !agent_id || !agentName) {
      return sendError(next, "Missing required fields: contactNo, agent_id, agentName", 400);
    }

    const record = await CallRecording.create({
      callingData_id: callingData_id || null,
      campaign_id: null, // TODO: pass campaign_id from frontend if available
      contactNo,
      agent_id,
      agentName,
      callId: callId || null,
      callStatus: "initiated",
      callSource: "tata",
      callingDate: new Date(),
      webHookResponse: [],
      misc: {},
    });

    return sendResponse(res, 200, "Call record created", record);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ── PATCH /api/tataCalling/updateCallId ──────────────────────────────────────
// Called when the frontend resolves the callId from live_calls polling.
// Updates the record created in initiateCallRecord with the actual Tata call_id.
const updateCallId = asyncHandler(async (req, res, next) => {
  try {
    const { recordId, callId } = req.body;

    if (!recordId || !callId) {
      return sendError(next, "Missing recordId or callId", 400);
    }

    const record = await CallRecording.findByIdAndUpdate(
      recordId,
      { callId, callStatus: "connected" },
      { new: true }
    );

    if (!record) return sendError(next, "Call record not found", 404);
    return sendResponse(res, 200, "Call ID updated", record);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ── PUT /api/tataCalling/hangup ──────────────────────────────────────────────
// Called by the frontend when the agent hangs up or auto-hangup is detected.
// Marks the call as completed and stores the call duration.
const hangupCallRecord = asyncHandler(async (req, res, next) => {
  try {
    const { callId, recordId, callDuration } = req.body;

    if (!callId && !recordId) {
      return sendError(next, "Provide callId or recordId", 400);
    }

    const filter = callId ? { callId } : { _id: recordId };

    const record = await CallRecording.findOneAndUpdate(
      filter,
      {
        callStatus: "completed",
        callDuration: callDuration || 0,
      },
      { new: true }
    );

    if (!record) return sendError(next, "Call record not found", 404);
    return sendResponse(res, 200, "Call marked as completed", record);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ── GET /api/tataCalling/status/:callId ──────────────────────────────────────
// Frontend polls this to check current call status and fetch recording URL
// once the Tata webhook delivers it.
const getCallStatus = asyncHandler(async (req, res, next) => {
  try {
    const { callId } = req.params;
    const record = await CallRecording.findOne({ callId }).select(
      "callStatus recording callDuration misc"
    );
    if (!record) return sendError(next, "Call record not found", 404);
    return sendResponse(res, 200, "Call status", record);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// ── POST /api/webhook/tataCallReport ─────────────────────────────────────────
// Tata SmartFlo sends this webhook when a call ends or a recording is ready.
// Configure the webhook URL in your Tata SmartFlo admin panel:
//   https://<your-domain>/api/webhook/tataCallReport
// Always responds 200 so Tata doesn't retry.
const tataSmartFloWebhook = asyncHandler(async (req, res) => {
  try {
    const payload = req.body;
    console.log("[Tata Webhook] received:", JSON.stringify(payload));

    const callId = payload.call_id || payload.uuid || payload.call_uuid || null;

    if (!callId) {
      console.warn("[Tata Webhook] No call_id in payload, skipping.");
      return res.status(200).json({ success: true });
    }

    const recordingUrl =
      payload.recording_url ||
      payload.filename ||
      payload.record_url ||
      payload.rec_file ||
      null;

    const duration =
      payload.duration != null ? Number(payload.duration) : undefined;

    const existing = await CallRecording.findOne({ callId });

    if (existing) {
      // Append raw webhook payload for full audit trail
      if (!Array.isArray(existing.webHookResponse)) existing.webHookResponse = [];
      existing.webHookResponse.push(payload);
      existing.callStatus = "completed";
      if (recordingUrl) existing.recording = recordingUrl;
      if (duration != null) existing.callDuration = duration;
      existing.misc = { ...existing.misc, lastWebhook: payload };
      await existing.save();
      console.log("[Tata Webhook] Record updated:", existing._id);
    } else {
      // Webhook arrived before frontend saved the record — create a minimal entry
      await CallRecording.create({
        callId,
        contactNo: payload.destination_number || payload.to || null,
        agentName: payload.agent || payload.user || null,
        callStatus: "completed",
        callSource: "tata",
        callDuration: duration || null,
        recording: recordingUrl,
        callingDate: payload.time ? new Date(Number(payload.time)) : new Date(),
        webHookResponse: [payload],
        misc: { lastWebhook: payload },
      });
      console.log("[Tata Webhook] New orphan record created for callId:", callId);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[Tata Webhook] Error:", err.message);
    // Always return 200 to Tata so it doesn't retry
    return res.status(200).json({ success: true });
  }
});

export {
  initiateCallRecord,
  updateCallId,
  hangupCallRecord,
  getCallStatus,
  tataSmartFloWebhook,
};
