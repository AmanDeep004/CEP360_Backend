import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const PrioritySlotSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    no:         { type: Number, required: true },
    label:      { type: String, required: true },
  },
  { timestamps: true }
);

PrioritySlotSchema.index({ campaignId: 1, no: 1 }, { unique: true });

export default getPrimaryConnection().model("PrioritySlot", PrioritySlotSchema);
