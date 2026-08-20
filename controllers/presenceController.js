import mongoose from "mongoose";
import AgentPresence from "../models/agentPresenceModel.js";
import PresenceSettings, { getPresenceSettings } from "../models/presenceSettingsModel.js";
import User from "../models/userModel.js";
import errorHandler from "../utils/index.js";
import { getRedis, isRedisAvailable } from "../config/redis.js";
import { UserRoleEnum } from "../utils/enum.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

// ─── Redis key helpers ────────────────────────────────────────────────────────
const PRES_KEY = (agentId) => `pres:${agentId}`;

// ─── IST day helpers ──────────────────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30

/** Returns start of current IST calendar day as UTC Date */
const todayIST = () => {
  const now = new Date();
  const istMs = now.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  istDate.setUTCHours(0, 0, 0, 0);
  return new Date(istDate.getTime() - IST_OFFSET_MS); // back to UTC
};

/** Seconds until end of current IST day (for Redis TTL) */
const secondsUntilEndOfISTDay = () => {
  const now = Date.now();
  const startOfToday = todayIST().getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
  return Math.max(Math.ceil((endOfToday - now) / 1000), 60);
};

// ─── Attendance computation ───────────────────────────────────────────────────
// Rules:
//   - 0 active ms                   → "not-logged-in"
//   - >= presentMinutes             → "present"
//   - >= halfDayMinutes             → "half-day"
//   - > 0, before office end        → "present"  (day still in progress — don't penalise)
//   - > 0, after office end         → "absent"   (day over, not enough hours)
const computeAttendance = (activeMs, settings) => {
  if (!activeMs || activeMs <= 0) return "not-logged-in";

  const activeMin = activeMs / 60000;
  if (activeMin >= settings.attendance.presentMinutes) return "present";
  if (activeMin >= settings.attendance.halfDayMinutes) return "half-day";

  // Check whether office hours are still ongoing (IST)
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  const [endHr, endMin] = (settings.attendance?.officeEnd || "18:30").split(":").map(Number);
  const officeEndMinutes  = endHr * 60 + endMin;
  const currentMinutes    = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();

  // Before office end → day still running → show "present" (agent checked in)
  if (currentMinutes < officeEndMinutes) return "present";

  // After office end and not enough hours → "absent"
  return "absent";
};

// ─── Read presence from Redis; returns null if key missing (= offline) ────────
const readRedis = async (agentId) => {
  if (!isRedisAvailable()) return null;
  try {
    const raw = await getRedis().get(PRES_KEY(agentId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// ─── Write presence to Redis ──────────────────────────────────────────────────
const writeRedis = async (agentId, data, ttlSeconds) => {
  if (!isRedisAvailable()) return;
  try {
    await getRedis().set(PRES_KEY(agentId), JSON.stringify(data), "EX", ttlSeconds);
  } catch {
    // non-fatal
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/presence/heartbeat
// Called every 30s by every logged-in agent
// Body: { status: "active" | "away" | "incall" }
// ═════════════════════════════════════════════════════════════════════════════
export const heartbeat = asyncHandler(async (req, res, next) => {
  const agentId  = req.user._id.toString();
  const inStatus = req.body.status || "active"; // frontend sends "active"/"away"/"incall"
  const now      = Date.now();

  const settings  = await getPresenceSettings();
  const offlineTTL = settings.offlineAfterMinutes * 60;

  // ── Read existing Redis state ──
  const prev = await readRedis(agentId);

  // ── Calculate active-time delta ──
  // Only count time when status was "active" (not away/incall).
  // Cap delta at 2x heartbeat interval to ignore large gaps (app woke from sleep, etc.)
  const maxDeltaMs = settings.heartbeatIntervalSeconds * 2 * 1000;
  let deltaMs = 0;
  if (prev && prev.status === "active" && inStatus === "active") {
    const rawDelta = now - prev.lastHeartbeat;
    deltaMs = Math.min(rawDelta, maxDeltaMs);
  }

  const prevTodayActiveMs = prev ? (prev.todayActiveMs || 0) : 0;
  const todayActiveMs     = prevTodayActiveMs + deltaMs;

  // ── Build new Redis state ──
  const newState = {
    status:         inStatus,
    lastHeartbeat:  now,
    todayActiveMs,
    loginAt:        prev?.loginAt || now,
  };
  await writeRedis(agentId, newState, offlineTTL);

  // ── Sync to MongoDB (upsert AgentPresence for today) ──
  const todayStart = todayIST();
  const attendance = computeAttendance(todayActiveMs, settings);

  await AgentPresence.findOneAndUpdate(
    { agentId: new mongoose.Types.ObjectId(agentId), date: todayStart },
    {
      $set: {
        totalActiveMs:    todayActiveMs,
        lastHeartbeat:    new Date(now),
        attendanceStatus: attendance,
      },
      $setOnInsert: { firstHeartbeat: new Date(now) },
    },
    { upsert: true, new: true }
  );

  return sendResponse(res, 200, "ok", { status: inStatus, todayActiveMs });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/presence/team
// PM sees all their agents' real-time presence
// ═════════════════════════════════════════════════════════════════════════════
export const getTeamPresence = asyncHandler(async (req, res, next) => {
  const isRM = [UserRoleEnum.RESOURCE_MANAGER, UserRoleEnum.ADMIN].includes(req.user.role);

  // RM / Admin → all active agents; PM → only their own agents
  const agentFilter = { role: UserRoleEnum.AGENT, status: "active" };
  if (!isRM) agentFilter.associatedProgramManager = req.user._id;

  const agents = await User.find(
    agentFilter,
    { employeeName: 1, employeeCode: 1, profilePicture: 1, associatedProgramManager: 1 }
  )
    .populate("associatedProgramManager", "employeeName")
    .lean();

  const settings   = await getPresenceSettings();
  const todayStart = todayIST();

  // Get today's MongoDB presence docs for all agents (for PM override + fallback)
  const agentIds = agents.map((a) => a._id);
  const presenceDocs = await AgentPresence.find(
    { agentId: { $in: agentIds }, date: todayStart },
    { agentId: 1, totalActiveMs: 1, attendanceStatus: 1, firstHeartbeat: 1, lastHeartbeat: 1, pmOverride: 1 }
  ).lean();
  const presenceMap = Object.fromEntries(presenceDocs.map((d) => [d.agentId.toString(), d]));

  // Build response with live Redis status
  const result = await Promise.all(
    agents.map(async (agent) => {
      const id       = agent._id.toString();
      const redisVal = await readRedis(id);
      const dbDoc    = presenceMap[id] || null;

      // Status: Redis = live source; no Redis key = offline
      const status       = redisVal ? redisVal.status : "offline";
      const lastSeen     = redisVal?.lastHeartbeat || dbDoc?.lastHeartbeat || null;
      const todayActiveMs =
        dbDoc?.pmOverride?.enabled
          ? dbDoc.pmOverride.adjustedMs
          : (redisVal?.todayActiveMs ?? dbDoc?.totalActiveMs ?? 0);
      const attendanceStatus = computeAttendance(todayActiveMs, settings);

      return {
        agentId:        id,
        name:           agent.employeeName,
        employeeCode:   agent.employeeCode || "",
        profilePicture: agent.profilePicture || null,
        pmName:         agent.associatedProgramManager?.employeeName || null,
        pmId:           agent.associatedProgramManager?._id?.toString() || null,
        status,
        lastSeen:       lastSeen ? new Date(lastSeen) : null,
        todayActiveMs,
        todayActiveFormatted: formatDuration(todayActiveMs),
        attendanceStatus,
        pmOverride:     dbDoc?.pmOverride || null,
      };
    })
  );

  return sendResponse(res, 200, "Team presence fetched", result);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/presence/settings
// ═════════════════════════════════════════════════════════════════════════════
export const getSettings = asyncHandler(async (_req, res) => {
  const settings = await getPresenceSettings();
  return sendResponse(res, 200, "Settings fetched", settings);
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/presence/settings
// Admin / PM updates thresholds
// ═════════════════════════════════════════════════════════════════════════════
export const updateSettings = asyncHandler(async (req, res, next) => {
  const allowed = [
    "awayAfterMinutes", "offlineAfterMinutes", "heartbeatIntervalSeconds",
    "attendance.presentMinutes", "attendance.halfDayMinutes",
    "attendance.officeStart", "attendance.officeEnd",
  ];

  const update = {};
  allowed.forEach((key) => {
    const val = key.includes(".") ? req.body[key] : req.body[key];
    if (val !== undefined) update[key] = val;
  });

  // Also handle nested attendance object from body
  if (req.body.attendance && typeof req.body.attendance === "object") {
    const att = req.body.attendance;
    if (att.presentMinutes !== undefined) update["attendance.presentMinutes"] = att.presentMinutes;
    if (att.halfDayMinutes !== undefined) update["attendance.halfDayMinutes"] = att.halfDayMinutes;
    if (att.officeStart    !== undefined) update["attendance.officeStart"]    = att.officeStart;
    if (att.officeEnd      !== undefined) update["attendance.officeEnd"]      = att.officeEnd;
  }

  let settings = await PresenceSettings.findOne();
  if (!settings) settings = new PresenceSettings({});
  Object.entries(update).forEach(([k, v]) => settings.set(k, v));
  await settings.save();

  return sendResponse(res, 200, "Settings updated", settings.toObject());
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/presence/override
// PM forcibly sets an agent's active time for a specific day
// Body: { agentId, date (ISO), adjustedMinutes, reason }
// ═════════════════════════════════════════════════════════════════════════════
export const pmOverride = asyncHandler(async (req, res, next) => {
  const { agentId, date, adjustedMinutes, reason } = req.body;

  if (!agentId || adjustedMinutes === undefined) {
    return sendError(next, "agentId and adjustedMinutes are required", 400);
  }

  const targetDate = date ? new Date(date) : todayIST();
  // Normalize to start of IST day
  const istMs     = targetDate.getTime() + IST_OFFSET_MS;
  const istDate   = new Date(istMs);
  istDate.setUTCHours(0, 0, 0, 0);
  const dayStart  = new Date(istDate.getTime() - IST_OFFSET_MS);

  const adjustedMs      = Math.max(0, adjustedMinutes * 60 * 1000);
  const settings        = await getPresenceSettings();
  const attendanceStatus = computeAttendance(adjustedMs, settings);

  const doc = await AgentPresence.findOneAndUpdate(
    { agentId: new mongoose.Types.ObjectId(agentId), date: dayStart },
    {
      $set: {
        "pmOverride.enabled":    true,
        "pmOverride.adjustedMs": adjustedMs,
        "pmOverride.reason":     reason || "",
        "pmOverride.byPmId":     req.user._id,
        "pmOverride.byPmName":   req.user.employeeName || "",
        "pmOverride.at":         new Date(),
        attendanceStatus,
      },
    },
    { upsert: true, new: true }
  ).lean();

  // If overriding today, also update Redis so live view reflects it immediately
  const isToday = dayStart.getTime() === todayIST().getTime();
  if (isToday && isRedisAvailable()) {
    const current = await readRedis(agentId);
    if (current) {
      current.todayActiveMs = adjustedMs;
      const settings2 = await getPresenceSettings();
      await writeRedis(agentId, current, settings2.offlineAfterMinutes * 60);
    }
  }

  return sendResponse(res, 200, "Override applied", {
    agentId,
    date: dayStart,
    adjustedMinutes,
    attendanceStatus,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/presence/attendance?agentId=&from=&to=
// PM views attendance history for their agents
// ═════════════════════════════════════════════════════════════════════════════
export const getAttendance = asyncHandler(async (req, res, next) => {
  const { agentId, from, to } = req.query;

  const filter = {};

  if (agentId) {
    filter.agentId = new mongoose.Types.ObjectId(agentId);
  } else {
    const isRM = [UserRoleEnum.RESOURCE_MANAGER, UserRoleEnum.ADMIN].includes(req.user.role);
    if (!isRM) {
      // PM: only their own agents
      const agents = await User.find(
        { role: UserRoleEnum.AGENT, associatedProgramManager: req.user._id, status: "active" },
        { _id: 1 }
      ).lean();
      filter.agentId = { $in: agents.map((a) => a._id) };
    }
    // RM/Admin: no agentId filter → all agents
  }

  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filter.date.$lte = toDate;
    }
  }

  const docs = await AgentPresence.find(filter)
    .populate({
      path: "agentId",
      select: "employeeName employeeCode associatedProgramManager",
      populate: { path: "associatedProgramManager", select: "employeeName" },
    })
    .sort({ date: -1 })
    .lean();

  const settings = await getPresenceSettings();
  const result = docs.map((d) => {
    const activeMs = d.pmOverride?.enabled ? d.pmOverride.adjustedMs : d.totalActiveMs;
    return {
      _id:              d._id,
      agent:            d.agentId,
      pmName:           d.agentId?.associatedProgramManager?.employeeName || null,
      date:             d.date,
      activeMs,
      activeFormatted:  formatDuration(activeMs),
      attendanceStatus: d.attendanceStatus,
      firstHeartbeat:   d.firstHeartbeat,
      lastHeartbeat:    d.lastHeartbeat,
      pmOverride:       d.pmOverride,
    };
  });

  return sendResponse(res, 200, "Attendance fetched", result);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
}
