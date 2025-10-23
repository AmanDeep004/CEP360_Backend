import CallingDataEditApproval from "../models/callingDataEditApprovalModel";
import errorHandler from "../utils/index.js";
import { updateData } from "./masterDbController/masterController.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const getAllPendingEditApprovals = asyncHandler(async (req, res, next) => {
  try {
    const pendingApprovals = await CallingDataEditApproval.find({
      status: "Pending",
    })
      .populate("requestedBy", "employeeName email employeeCode mobile")
      .populate(
        "approvedorRejectedBy",
        "employeeName email employeeCode mobile"
      )
      .populate("callingDataId", "CampaignId");
    return sendResponse(
      res,
      200,
      "Pending Calling Data Retrieved Successfully",
      pendingApprovals
    );
  } catch (error) {
    return sendError(
      next,
      err.message || "Failed to fetch campaign filters",
      500
    );
  }
});

const approveOrRejectEditRequest = asyncHandler(async (req, res, next) => {
  try {
    const { status, remarks, callingDataId } = req.body;

    const editRequest = await CallingDataEditApproval.findById(callingDataId);
    if (!editRequest) {
      return sendError(next, "Edit request not found", 404);
    }

    editRequest.status = status;
    editRequest.remarks = remarks || "";
    editRequest.approvedorRejectedBy = req.user?._id;
    editRequest.approvedOrRejectedAt = new Date();
    await editRequest.save();

    if (status === "Approved") {
      // Build update payload from changedFields
      const updatePayload = {};
      editRequest.changedFields.forEach((change) => {
        updatePayload[change.field] = change.newValue;
      });

      // Call updateData controller logic directly
      req.params.id = editRequest.callingDataId; // Set contact ID
      req.body = updatePayload;
      await updateData(req, res, next); // This will send the response
      return; // Prevent double response
    }

    // If rejected, just send response
    return sendResponse(res, 200, "Edit request status updated", {
      id: editRequest._id,
      status: editRequest.status,
      remarks: editRequest.remarks,
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to update edit request", 500);
  }
});

export { getAllPendingEditApprovals };
