import CallRecording from "../models/callRecordingModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const createCallRecording = asyncHandler(async (req, res, next) => {
  try {
    const {
      callingData_id,
      campaign_id,
      sessionId,
      contactNo,
      callingDate,
      agent_id,
      agentName,
      callId,
      recording,
      webHookResponse,
    } = req.body;

    if (
      !callingData_id ||
      !campaign_id ||
      !contactNo ||
      !agent_id ||
      !agentName ||
      !callId
    ) {
      return sendError(next, "Missing required fields", 400);
    }

    const newEntry = await CallRecording.create({
      callingData_id,
      campaign_id,
      sessionId: sessionId || null,
      contactNo,
      callingDate: callingDate || new Date(),
      agent_id,
      agentName,
      callId,
      recording: recording || null,
      webHookResponse: webHookResponse || null,
    });

    return sendResponse(
      res,
      200,
      "Call recording entry created successfully",
      newEntry
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const updateCallRecordingByCallId = asyncHandler(async (req, res, next) => {
  try {
    const { callId } = req.params;
    const { recording, webHookResponse, sessionId } = req.body;

    if (!callId) {
      return sendError(next, "CallId is required", 400);
    }

    // Find the call recording entry
    let existing = await CallRecording.findOne({ callId });

    if (!existing) {
      return sendError(next, "No call recording found for this callId", 404);
    }

    // Update fields only if provided
    if (sessionId) existing.sessionId = sessionId;
    if (recording) existing.recording = recording;
    if (webHookResponse) existing.webHookResponse = webHookResponse;

    existing.callingDate = new Date(); // optional: update timestamp

    const updated = await existing.save();

    return sendResponse(
      res,
      200,
      "Call recording updated successfully",
      updated
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const telcmiWebhook = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log("Telecmi Webhook received:", payload);

    // TeleCMI sends unique ID as cmiuuid or call_uuid
    const callId = payload.cmiuuid || payload.call_uuid;

    if (!callId) {
      return sendError(next, "Missing callId (cmiuuid) in webhook", 400);
    }

    const existing = await CallRecording.findOne({ callId });

    if (!existing) {
      return sendError(
        next,
        `No CallRecording entry found for callId: ${callId}`,
        404
      );
    }

    // Extract recording URL
    const recordingUrl =
      payload?.recording_url ||
      payload?.record_url ||
      payload?.rec_file ||
      null;

    // Update only if present
    if (recordingUrl) existing.recording = recordingUrl;

    // Save raw webhook data into both fields as per your schema
    existing.webHookResponse = payload;
    existing.payload = payload;

    // Save misc fields separately (helpful for analytics)
    existing.misc = {
      duration: payload?.duration || payload?.call_duration || null,
      status: payload?.status || payload?.event || null,
      agent: payload?.agent || null,
      caller: payload?.customer || null,
      timestamp: payload?.event_time || null,
    };

    if (payload.event_time) {
      existing.callingDate = new Date(payload.event_time);
    }

    const updated = await existing.save();

    return sendResponse(
      res,
      200,
      "CallRecording updated successfully",
      updated
    );
  } catch (err) {
    return sendError(next, err.message || "Webhook processing error", 500);
  }
});

export { createCallRecording, updateCallRecordingByCallId, telcmiWebhook };
