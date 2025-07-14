import mongoose from "mongoose";

const filesSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      required: true,
    },
    subtype: {
      type: String,
    },
    extension: {
      type: String,
    },
    fileSrc: {
      type: String,
      required: true,
    },
    // fileName: {
    //   type: String,
    // },
    originalName: {
      type: String,
    },
    mimeType: {
      type: String,
    },
  },
  { timestamps: true }
);

const UploadedFiles = mongoose.model("UploadedFiles", filesSchema);
export default UploadedFiles;
