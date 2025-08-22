import mongoose from "mongoose";
const DndSchema = new mongoose.Schema(
  {
    contact_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    unsubscribe_flag: { type: Boolean, default: false, index: true },
    unsubscribe_account_tag: { type: String, trim: true },
    dnd_flag: { type: Boolean, default: false, index: true },
    dnd_account_tag: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("DndDetail", DndSchema);
