import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const agentAssignedSchema = new mongoose.Schema(
  {
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    isAssigned: { type: Boolean, default: true },
    assigned_date: { type: Date, default: Date.now },
    released_date: { type: Date, default: null },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "AgentAssigned",
  agentAssignedSchema
);
