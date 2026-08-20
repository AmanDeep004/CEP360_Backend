import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

// Single global settings document (singleton pattern — only one doc ever exists)
const PresenceSettingsSchema = new mongoose.Schema(
  {
    awayAfterMinutes: { type: Number, default: 5, min: 1 },       // idle → away
    offlineAfterMinutes: { type: Number, default: 15, min: 2 },   // no heartbeat → offline
    heartbeatIntervalSeconds: { type: Number, default: 30 },      // frontend sends every N seconds

    attendance: {
      presentMinutes: { type: Number, default: 480 },  // > 8 hrs  → Present
      halfDayMinutes: { type: Number, default: 240 },  // > 4 hrs  → Half Day  (else Absent)
      officeStart:    { type: String, default: "09:30" },
      officeEnd:      { type: String, default: "18:30" },
    },
  },
  { timestamps: true }
);

const PresenceSettings = getPrimaryConnection().model(
  "PresenceSettings",
  PresenceSettingsSchema
);

// Utility: always returns the single settings doc, creates default if missing
export const getPresenceSettings = async () => {
  let settings = await PresenceSettings.findOne().lean();
  if (!settings) {
    settings = await PresenceSettings.create({});
    settings = settings.toObject();
  }
  return settings;
};

export default PresenceSettings;
