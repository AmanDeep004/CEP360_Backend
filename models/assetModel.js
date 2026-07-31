import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const { Schema } = mongoose;

const assetHistorySchema = new Schema(
  {
    action:          { type: String, enum: ["assigned", "released"], required: true },
    agent:           { type: Schema.Types.ObjectId, ref: "User", default: null },
    agentName:       { type: String, default: null },
    agentCode:       { type: String, default: null },
    pm:              { type: Schema.Types.ObjectId, ref: "User", default: null },
    pmName:          { type: String, default: null },
    performedBy:     { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedByName: { type: String, required: true },
    note:            { type: String, default: "" },
    timestamp:       { type: Date, default: Date.now },
  },
  { _id: true }
);

const assetSchema = new Schema(
  {
    assetNo:           { type: String, required: true, unique: true, trim: true },
    vendorName:        { type: String, trim: true, default: "" },
    assetBrand:        { type: String, trim: true, default: "" },
    assetModel:        { type: String, trim: true, default: "" },
    assetSerialNumber: { type: String, trim: true, unique: true, sparse: true, default: null },

    status:        { type: String, enum: ["assigned", "unassigned"], default: "unassigned" },
    assignedAgent: { type: Schema.Types.ObjectId, ref: "User", default: null },
    associatedPM:  { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedBy:    { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt:    { type: Date, default: null },

    history: [assetHistorySchema],
  },
  { timestamps: true }
);

assetSchema.index({ status: 1 });
assetSchema.index({ associatedPM: 1 });
assetSchema.index({ assignedAgent: 1 });

const Asset = () => {
  const conn = getPrimaryConnection();
  return conn.model("Asset", assetSchema);
};

export default Asset;
