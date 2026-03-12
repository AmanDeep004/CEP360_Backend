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

const telcmiWebhookOld = asyncHandler(async (req, res, next) => {
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

const telcmiWebhook1 = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log("TeleCMI Webhook received:", payload);
    const callId = payload.call_id;

    if (!callId) {
      return sendError(next, "Missing callId (call_id / cmiuuid)", 400);
    }

    // Find using stable unique key: cmiuuid
    let existing = await CallRecording.findOne({ callId });

    if (!existing) {
      return sendError(
        next,
        `CallRecording not found for callId: ${callId}`,
        404
      );
    }

    // Recording handling
    // TeleCMI sends filename only, not URL
    const filename =
      payload.filename ||
      payload.recording_url ||
      payload.record_url ||
      payload.rec_file ||
      null;

    if (filename) {
      existing.filename = filename;
      existing.recording = filename; // store filename as recording
    }

    // Save complete payload
    existing.payload = payload;
    existing.webHookResponse = payload;

    // Convert TeleCMI time (UNIX ms)
    if (payload.time) {
      existing.callingDate = new Date(Number(payload.time));
    }

    // Save useful misc fields
    existing.misc = {
      duration: payload?.duration || null,
      answeredsec: payload?.answeredsec || null,
      waitedsec: payload?.waitedsec || null,

      status: payload?.status || null,
      hangup_reason: payload?.hangup_reason || null,
      direction: payload?.direction || null,

      time: payload?.time || null,
      user: payload?.user || null,
      team: payload?.team || null,
      leg: payload?.leg || null,
      type: payload?.type || null,
    };

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

const telcmiWebhook = asyncHandler(async (req, res, next) => {
  try {
    const payload = req.body;
    console.log("TeleCMI Webhook received:", payload);
    console.log("callId----:", payload.call_id);
    console.log("filename----:", payload.filename);

    const callId = payload.call_id || null;

    let record = null;

    if (callId) {
      const matches = await CallRecording.find({ callId });

      if (matches.length > 0) {
        record = matches[0];

        // optional: delete duplicates
        if (matches.length > 1) {
          const duplicates = matches.slice(1).map((d) => d._id);
          await CallRecording.deleteMany({ _id: { $in: duplicates } });
          console.log("Duplicate callId entries removed:", duplicates);
        }
      }
    }

    // Create new if no record found OR callId is null
    if (!record) {
      record = new CallRecording({
        callId,
        contactNo: payload.to || payload.from || null,
        agentName: payload.user || null,
        recording: null,
        webHookResponse: [],
        misc: {},
      });
    }

    // filename check
    const filename =
      payload.filename ||
      payload.recording_url ||
      payload.record_url ||
      payload.rec_file ||
      null;

    if (filename) {
      record.recording = filename;
    }

    // ensure array exists
    if (!Array.isArray(record.webHookResponse)) {
      record.webHookResponse = [];
    }
    record.webHookResponse.push(payload);

    // update date
    if (payload.time) {
      record.callingDate = new Date(Number(payload.time));
    }

    // misc merge
    record.misc = {
      ...record.misc,
      duration: payload.duration ?? record.misc.duration ?? null,
      answeredsec: payload.answeredsec ?? record.misc.answeredsec ?? null,
      waitedsec: payload.waitedsec ?? record.misc.waitedsec ?? null,
      status: payload.status ?? record.misc.status ?? null,
      hangup_reason: payload.hangup_reason ?? record.misc.hangup_reason ?? null,
      direction: payload.direction ?? record.misc.direction ?? null,
      time: payload.time ?? record.misc.time ?? null,
      user: payload.user ?? record.misc.user ?? null,
      team: payload.team ?? record.misc.team ?? null,
      leg: payload.leg ?? record.misc.leg ?? null,
      type: payload.type ?? record.misc.type ?? null,
      virtual_number:
        payload.virtual_number ?? record.misc.virtual_number ?? null,
    };

    const saved = await record.save();
    return sendResponse(res, 200, "Webhook processed successfully", saved);
  } catch (err) {
    return sendError(next, err.message || "Webhook processing error", 500);
  }
});

export { createCallRecording, telcmiWebhook };
