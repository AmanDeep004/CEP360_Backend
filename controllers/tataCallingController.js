/**
 * tataCallingController.js
 * Click-to-call via Tata SmartFlo (agent's own token, per-agent credentials).
 *
 * Flow:
 *  1. Agent clicks a phone number in CRM  →  POST /tataCalling/call
 *  2. Backend calls Tata click_to_call with agent's tataTeleLoginId + tataDIDNo
 *  3. Agent's SmartFlo Chrome extension rings  →  softphone pops up
 *  4. Agent accepts on softphone  →  Tata dials the customer
 *  5. Frontend polls GET /tataCalling/live every 3s  →  detects connection
 *  6. Agent/customer hangs up  →  PUT /tataCalling/hangup
 *  7. Tata webhook fires  →  POST /api/webhook/tataCallReport  →  recording saved
 *
 * Token: each agent logs into Tata using their own tataSmartFlowId/Password (frontend).
 *        Token is passed to backend via request body (initiateCall) or x-tata-token header.
 */

import CallRecording from "../models/callRecordingModel.js";
import User from "../models/userModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const TATA_BASE = "https://api-smartflo.tatateleservices.com";

// ── Tata API helpers (use agent's own token passed from frontend) ─────────────

const tataPost = async (token, endpoint, body) => {
  const res = await fetch(`${TATA_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // Tata sometimes returns 200 with success:false (e.g. "Agent is Offline")
  if (!res.ok || data?.success === false) {
    console.error("[Tata] API failure response:", JSON.stringify(data));
    throw new Error(data?.message || data?.error || `Tata error ${res.status}`);
  }
  return data;
};

const tataGet = async (token, endpoint) => {
  const res = await fetch(`${TATA_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data?.message || data?.error || `Tata error ${res.status}`);
  return data;
};

// ── POST /tataCalling/call ────────────────────────────────────────────────────
// Frontend sends: { agentId, tataToken, destinationNumber, callingDataId }
// Backend fetches agent's tataDIDNo from DB and uses it as agent_number + caller_id.
const initiateCall = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, tataToken, destinationNumber, callingDataId } = req.body;

    if (!agentId || !tataToken || !destinationNumber) {
      return sendError(
        next,
        "agentId, tataToken and destinationNumber are required",
        400
      );
    }

    // Fetch agent's Tata config from DB
    const agent = await User.findById(agentId).select(
      "employeeName tataDIDNo tataTeleLoginId"
    );
    if (!agent) return sendError(next, "Agent not found", 404);

    const didNo = agent.tataDIDNo;
    const tataTeleLoginId = agent.tataTeleLoginId;
    if (!tataTeleLoginId) {
      return sendError(
        next,
        "Agent's Tata Tele Login ID is not configured. Please contact admin.",
        400
      );
    }
    if (!didNo) {
      return sendError(
        next,
        "Agent's Tata DID No is not configured. Please contact admin.",
        400
      );
    }

    // Normalise destination → digits only, prefixed with 91
    let dest = String(destinationNumber).replace(/[^\d]/g, "");
    if (!dest.startsWith("91")) dest = `91${dest}`;

    // Call Tata click_to_call using agent's own token
    let tataCallId = null;
    let tataRefId = null;
    try {
      const tataPayload = {
        agent_number: String(tataTeleLoginId),
        destination_number: dest,
        caller_id: String(didNo),
        async: 1,
      };
      if (callingDataId) tataPayload.custom_identifier = String(callingDataId);

      console.log("[Tata] click_to_call payload:", tataPayload);
      const tataRes = await tataPost(
        tataToken,
        "/v1/click_to_call",
        tataPayload
      );
      console.log("[Tata] click_to_call response:", tataRes);
      // Tata returns ref_id (queued call reference), not call_id yet.
      // The actual call_id appears in live_calls once the call connects.
      tataCallId = tataRes?.call_id || null;
      tataRefId = tataRes?.ref_id || null;
      if (tataRefId) console.log("[Tata] ref_id (queued):", tataRefId);
    } catch (tataErr) {
      console.error("[Tata] click_to_call failed:", tataErr.message);
      const msg = tataErr.message || "";
      const isOffline =
        msg.toLowerCase().includes("offline") ||
        msg.toLowerCase().includes("agent is offline");
      return sendError(
        next,
        isOffline ? "AGENT_OFFLINE" : `Tata API error: ${msg}`,
        isOffline ? 400 : 502
      );
    }

    // Create CallRecording entry
    const record = await CallRecording.create({
      callingData_id: callingDataId || null,
      campaign_id: null,
      contactNo: dest,
      agent_id: agentId,
      agentName: agent.employeeName || "Agent",
      callId: tataCallId || null,
      callStatus: "initiated",
      callSource: "tata",
      callingDate: new Date(),
      webHookResponse: [],
      misc: {
        didNo,
        tataTeleLoginId: agent.tataTeleLoginId || null,
        tataRefId: tataRefId || null,
      },
    });

    return sendResponse(res, 200, "Call initiated", {
      recordId: record._id,
      callId: tataCallId,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /tataCalling/live ─────────────────────────────────────────────────────
// Proxies Tata's live_calls query for the logged-in agent.
// Frontend polls this to detect when the call connects and to detect remote hangup.
const getLiveCalls = asyncHandler(async (req, res, next) => {
  try {
    const tataToken = req.headers["x-tata-token"];
    if (!tataToken)
      return sendError(next, "x-tata-token header is required", 400);

    // Get tataTeleLoginId from the logged-in user
    const agent = await User.findById(req.user._id).select("tataTeleLoginId");
    if (!agent?.tataTeleLoginId)
      return sendError(next, "Agent's Tata Tele Login ID is not configured", 400);

    const data = await tataGet(
      tataToken,
      `/v1/live_calls?agent_number=${encodeURIComponent(agent.tataTeleLoginId)}`
    );
    console.log("[Tata] live_calls raw:", JSON.stringify(data));
    const calls =
      data?.data || data?.calls || (Array.isArray(data) ? data : []);
    return sendResponse(res, 200, "Live calls", { calls });
  } catch (err) {
    console.warn("[Tata] live_calls proxy error:", err.message);
    return sendResponse(res, 200, "Live calls", { calls: [] });
  }
});

// ── PUT /tataCalling/hangup ───────────────────────────────────────────────────
// Tells Tata to hang up the call and marks the CallRecording as completed.
const hangupCall = asyncHandler(async (req, res, next) => {
  try {
    let { callId, recordId } = req.body;

    if (!callId && !recordId) {
      return sendError(next, "Provide callId or recordId", 400);
    }

    const tataToken = req.headers["x-tata-token"];

    // If callId not known yet (still ringing), fetch live call from Tata
    if (!callId && tataToken) {
      try {
        const agent = await User.findById(req.user._id).select("tataTeleLoginId");
        if (agent?.tataTeleLoginId) {
          const liveData = await tataGet(
            tataToken,
            `/v1/live_calls?agent_number=${encodeURIComponent(agent.tataTeleLoginId)}`
          );
          const liveCalls =
            liveData?.data || liveData?.calls || (Array.isArray(liveData) ? liveData : []);
          if (liveCalls.length > 0) {
            callId = liveCalls[0].call_id || liveCalls[0].uuid || liveCalls[0].id || null;
            console.log("[Tata] Resolved callId from live_calls for hangup:", callId);
          }
        }
      } catch (e) {
        console.warn("[Tata] Could not fetch live_calls for hangup:", e.message);
      }
    }

    // Tell Tata to end the call
    if (callId && tataToken) {
      try {
        const hangupRes = await tataPost(tataToken, "/v1/call/hangup", { call_id: callId });
        console.log("[Tata] hangup response:", hangupRes);
      } catch (e) {
        console.warn("[Tata] hangup API error (ignored):", e.message);
      }
    }

    // Update DB record
    const filter = callId ? { callId } : { _id: recordId };
    const record = await CallRecording.findOneAndUpdate(
      filter,
      { callStatus: "completed" },
      { new: true }
    );

    return sendResponse(res, 200, "Call ended", record || { callId, recordId });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── PATCH /tataCalling/updateCallId ──────────────────────────────────────────
// Updates the CallRecording with the resolved Tata call_id once live_calls returns it.
const updateCallId = asyncHandler(async (req, res, next) => {
  try {
    const { recordId, callId } = req.body;
    if (!recordId || !callId)
      return sendError(next, "Missing recordId or callId", 400);

    const record = await CallRecording.findByIdAndUpdate(
      recordId,
      { callId, callStatus: "connected" },
      { new: true }
    );
    if (!record) return sendError(next, "Call record not found", 404);
    return sendResponse(res, 200, "Call ID updated", record);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── GET /tataCalling/status/:callId ──────────────────────────────────────────
// Returns the current status and recording URL for a call (polled after hangup).
const getCallStatus = asyncHandler(async (req, res, next) => {
  try {
    const { callId } = req.params;
    const record = await CallRecording.findOne({ callId }).select(
      "callStatus recording callDuration misc"
    );
    if (!record) return sendError(next, "Call record not found", 404);
    return sendResponse(res, 200, "Call status", record);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// ── POST /api/webhook/tataCallReport ─────────────────────────────────────────
// Tata SmartFlo fires this when a call ends or a recording is ready.
// Configure in Tata admin panel: https://<your-domain>/api/webhook/tataCallReport
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
      if (!Array.isArray(existing.webHookResponse))
        existing.webHookResponse = [];
      existing.webHookResponse.push(payload);
      existing.callStatus = "completed";
      if (recordingUrl) existing.recording = recordingUrl;
      if (duration != null) existing.callDuration = duration;
      existing.misc = { ...existing.misc, lastWebhook: payload };
      await existing.save();
      console.log("[Tata Webhook] Record updated:", existing._id);
    } else {
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
      console.log("[Tata Webhook] Orphan record created for callId:", callId);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[Tata Webhook] Error:", err.message);
    return res.status(200).json({ success: true }); // always 200 so Tata doesn't retry
  }
});

export {
  initiateCall,
  getLiveCalls,
  hangupCall,
  updateCallId,
  getCallStatus,
  tataSmartFloWebhook,
};
