
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
