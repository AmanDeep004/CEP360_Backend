import mongoose from "mongoose";

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

export default mongoose.model("AgentAssigned", agentAssignedSchema);
