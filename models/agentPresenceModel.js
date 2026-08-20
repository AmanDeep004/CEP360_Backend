import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

// One document per agent per calendar day (IST)
const AgentPresenceSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // date = start of IST day (e.g. 2026-08-20T00:00:00.000+05:30 stored as UTC)
    date: { type: Date, required: true, index: true },

    // Cumulative active milliseconds for the day (synced from Redis on every heartbeat)
    totalActiveMs: { type: Number, default: 0 },

    firstHeartbeat: { type: Date, default: null }, // when agent first came online today
    lastHeartbeat:  { type: Date, default: null }, // latest heartbeat received today

    // Computed attendance — recalculated on every heartbeat + on PM override
    attendanceStatus: {
      type: String,
      enum: ["present", "half-day", "absent", "holiday", "not-logged-in"],
      default: "not-logged-in",
    },

    // PM can forcibly adjust the active time for this agent on this day
    pmOverride: {
      enabled:     { type: Boolean, default: false },
      adjustedMs:  { type: Number, default: 0 },   // the PM-set value (overrides totalActiveMs)
      reason:      { type: String, default: "" },
      byPmId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      byPmName:    { type: String, default: "" },
      at:          { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Unique: one doc per agent per day
AgentPresenceSchema.index({ agentId: 1, date: 1 }, { unique: true });

export default getPrimaryConnection().model("AgentPresence", AgentPresenceSchema);
