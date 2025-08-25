import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";
const attendenceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model("Attendence", attendenceSchema);
