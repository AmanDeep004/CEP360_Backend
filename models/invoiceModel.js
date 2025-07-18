import mongoose from "mongoose";

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
    noOfDaysWorked: { type: Number },
    noOfDaysAbsent: { type: Number },
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
    totalDaysGenerated: {
      type: Number,
    },
    daysAvailabletoGenerate: {
      type: Number,
    },
    salary: {
      type: Number,
      required: true,
    },
    invoiceGenerated: { type: invoiceGeneratedSchema },
  },
  { timestamps: true }
);

export default mongoose.model("Invoice", invoiceSchema);
