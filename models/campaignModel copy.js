import mongoose from "mongoose";
import User from "./userModel.js";
import { ProgramType } from "../utils/enum.js";
const { ALL } = ProgramType;

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Program Name is required"],
      trim: true,
      maxlength: [50, "Program Name cannot be more than 50 characters"],
      unique: [true, "Campaign name must be unique"],
    },

    type: { type: String, required: true },
    // type: { type: String, enum: { values: ALL }, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    programManager: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: [
        (array) => array.length > 0,
        "At least one Program Manager is required",
      ],
    },
    status: {
      type: String,
      required: true,
      default: "active",
      enum: ["active", "inactive", "completed"],
    },
    keyAccountManager: { type: String, required: false },
    jcNumber: { type: String, required: false },
    brandName: { type: String, required: false },
    clientName: { type: String, required: false },
    clientEmail: { type: String, required: false },
    clientContact: { type: String, required: false },
    comments: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("Campaign", campaignSchema);
