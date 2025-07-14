// import { getUploadSingle, uploadToS3 } from "../utils/upload.js";

// const uploadSingle = getUploadSingle();

// export const uploadSingleFile = (req, res, next) => {
//   uploadSingle.single("file")(req, res, async (err) => {
//     if (err) {
//       return res.status(500).json({ error: "Error uploading file", details: err.message });
//     }
//     if (!req.file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }
//     try {
//       const fileUrl = await uploadToS3(req.file);
//       res.json({ success: true, fileUrl });
//     } catch (s3err) {
//       res.status(500).json({ error: "S3 upload failed", details: s3err.message });
//     }
//   });
// };

import upload from "../services/uploadFilesServices.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

export const UploadData = asyncHandler(async (req, res, next) => {
  try {
    const result = await upload(req);
    //console.log("UploadData result:", result);

    if (result.error) {
      return sendError(
        next,
        result.message || "File upload failed",
        result.status || 400
      );
    }

    return sendResponse(
      res,
      result.status || 200,
      result.message || "File uploaded successfully",
      result.data
    );
  } catch (error) {
    console.error("Error in UploadData:", error);
    return sendError(next, error.message, 500);
  }
});

export default UploadData;
