import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const invoiceGeneratedSchema = new mongoose.Schema(
  {
    status: {
      type: Boolean,
      default: false,
    },
    genBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    invoiceUrl: {
      type: String,
    },
  },
  { timestamps: true }
);
{
  timestamps: true;
}
const invoiceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isMultiCampaign: {
      type: Boolean,
      default: false,
    },
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    programManagers: {
      type: [mongoose.Schema.Types.objectId],
      ref: "User",
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    month: { type: String, req: true },
    noOfDaysWorked: { type: Number },    // weekday present days in agent's period
    noOfDaysAbsent: { type: Number },    // weekday absent days in agent's period
    noOfDaysPresent: { type: Number },   // manually overridden present days
    totalWorkingDays: { type: Number },  // Mon-Fri in agent's actual sub-period
    monthWorkingDays: { type: Number },  // Mon-Fri in full salary cycle (divisor for per-day rate)
    forgivenAbsent: { type: Number, default: 1 },
    effectiveAbsent: { type: Number },
    payableDays: { type: Number },
    ctc: { type: Number },
    incentive: { type: Number },
    arrears: { type: Number },
    extraPay: { type: Number },
    salaryGenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    salaryModBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    totalDaysGenerated: { type: Number },
    daysAvailabletoGenerate: { type: Number },
    salary: {
      type: Number,
      required: true,
    },
    invoiceGenerated: { type: invoiceGeneratedSchema },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model("Invoice", invoiceSchema);
