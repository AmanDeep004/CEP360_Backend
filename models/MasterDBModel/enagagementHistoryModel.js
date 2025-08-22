import mongoose from "mongoose";
const EngagementSchema = new mongoose.Schema(
  {
    contact_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    last_engagement: { type: String, trim: true },
    last_engagement_date: { type: Date },
    last_engagement_campaign: { type: String, trim: true },
    telecalling_remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("EngagementHistory", EngagementSchema);
