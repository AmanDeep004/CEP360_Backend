import CallingDataEditApproval from "../models/callingDataEditApprovalModel.js";
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

const approveOrRejectEditRequestCopy = asyncHandler(async (req, res, next) => {
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
      const updatePayload = {};
      editRequest.changedFields.forEach((change) => {
        updatePayload[change.field] = change.newValue;
      });

      req.params.id = editRequest.callingDataId;
      req.body = updatePayload;
      await updateData(req, res, next); // This will send the response
      return; // Prevent double response
    }

    return sendResponse(res, 200, "Edit request status updated", {
      id: editRequest._id,
      status: editRequest.status,
      remarks: editRequest.remarks,
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to update edit request", 500);
  }
});

const approveOrRejectEditRequest = asyncHandler(async (req, res, next) => {
  console.log("approveOrRejectEditRequest called");

  try {
    const { status, remarks, callingDataId } = req.body;

    const editRequest = await CallingDataEditApproval.findById(callingDataId);
    if (!editRequest) return sendError(next, "Edit request not found", 404);

    // ✅ Always update status first
    editRequest.status = status;
    editRequest.remarks = remarks || "";
    editRequest.approvedorRejectedBy = req.user?._id;
    editRequest.approvedOrRejectedAt = new Date();
    await editRequest.save();

    // If Rejected → End here (No Company / Contact Update)
    if (status === "Rejected" || status === "Pending") {
      return sendResponse(res, 200, `Edit request ${status} successfully`, {
        id: editRequest._id,
        status: editRequest.status,
      });
    }

    // ✅ If Approved → Continue with Company & Contact update
    const companyFields = [
      "Company_ID_Kestone",
      "Affinity_ID_Dell",
      "Company_ID_Google",
      "Company_Source",
      "Company_Name",
      "Year_Founded",
      "Turnover_Range",
      "Employees_Range",
      "Industry",
      "Sub_Industry",
      "Company_Segment",
      "Website",
      "Company_LinkedIn_Profile",
      "Company_Phone1",
      "Company_Phone2",
    ];

    const contactFields = [
      "First_Name",
      "Last_Name",
      "Designation",
      "Email",
      "Phone_Number",
      "Mobile_Number",
      "LinkedIn",
    ];

    const companyUpdate = {};
    const contactUpdate = {};

    // Separate which fields belong to which model
    editRequest.changedFields.forEach((change) => {
      if (companyFields.includes(change.field)) {
        companyUpdate[change.field] = change.newValue;
      }
      if (contactFields.includes(change.field)) {
        contactUpdate[change.field] = change.newValue;
      }
    });

    // Update Company & Create History
    if (Object.keys(companyUpdate).length > 0) {
      const company = await Company.findById(editRequest.callingDataId);
      await CompanyHistory.create({
        company_id: company._id,
        snapshot: company.toObject(),
        updatedFields: Object.keys(companyUpdate),
        updatedBy: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          mobile: req.user.mobile,
          role: req.user.role,
          designation: req.user.designation,
          location: req.user.location,
        },
      });
      await Company.findByIdAndUpdate(company._id, companyUpdate);
    }

    // Update Contact & Create History
    if (Object.keys(contactUpdate).length > 0) {
      const contact = await Contact.findOne({
        company_id: editRequest.callingDataId,
      });
      if (contact) {
        await ContactHistory.create({
          contact_id: contact._id,
          snapshot: contact.toObject(),
          updatedFields: Object.keys(contactUpdate),
          updatedBy: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            mobile: req.user.mobile,
            role: req.user.role,
            designation: req.user.designation,
            location: req.user.location,
          },
        });
        await Contact.findByIdAndUpdate(contact._id, contactUpdate);
      }
    }

    return sendResponse(res, 200, "Edit request approved and changes applied");
  } catch (err) {
    return sendError(next, err.message || "Something went wrong", 500);
  }
});

export { getAllPendingEditApprovals, approveOrRejectEditRequest };
