// models/EmailStatus.js
import mongoose from "mongoose";
import { getPrimaryConnection } from "../../config/db.js";

const EmailStatusSchema = new mongoose.Schema({
  email: { type: String },
  event: { type: String }, // e.g., "sent", "opened", etc.
  campaignId: { type: String },
  timestamp: { type: Date, default: Date.now },
  data,
});

export default getPrimaryConnection().model("EmailStatus", EmailStatusSchema);
