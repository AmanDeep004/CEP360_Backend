import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const ContactHistorySchema = new mongoose.Schema(
  {
    contact_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    snapshot: { type: Object },
    updatedFields: { type: [String] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
    changeType: {
      type: String,
      enum: ["update", "delete"],
      default: "update",
    },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "ContactHistory",
  ContactHistorySchema
);
