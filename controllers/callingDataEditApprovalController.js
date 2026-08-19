import CallingDataEditApproval from "../models/callingDataEditApprovalModel.js";
import CallingData from "../models/callingDataModal.js";
import Company from "../models/MasterDBModel/companyModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import CompanyHistory from "../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../models/MasterDBModel/contactHistory.js";
import errorHandler from "../utils/index.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const getAllPendingEditApprovals = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filter = { status: "Pending" };

    // No page param → flat array (backward compat)
    if (!page) {
      const pendingApprovals = await CallingDataEditApproval.find(filter)
        .populate("requestedBy", "employeeName email employeeCode mobile")
        .populate("approvedorRejectedBy", "employeeName email employeeCode mobile")
        .populate("callingDataId", "CampaignId");
      return sendResponse(res, 200, "Pending Calling Data Retrieved Successfully", pendingApprovals);
    }

    const skip = (page - 1) * limit;
    const [total, pendingApprovals] = await Promise.all([
      CallingDataEditApproval.countDocuments(filter),
      CallingDataEditApproval.find(filter)
        .populate("requestedBy", "employeeName email employeeCode mobile")
        .populate("approvedorRejectedBy", "employeeName email employeeCode mobile")
        .populate("callingDataId", "CampaignId")
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Pending Calling Data Retrieved Successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: pendingApprovals,
    });
  } catch (error) {
    return sendError(next, error.message || "Failed to fetch pending approvals", 500);
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

// Fields that belong to MasterDB Company schema
const COMPANY_FIELDS = [
  "Company_Name", "Company_ID_Kestone", /* "Affinity_ID_Dell", "Company_ID_Google", */
  "Company_Source", "Year_Founded", "Turnover_Range", "Employees_Range",
  "Industry", "Sub_Industry", "Company_Segment",
  "Website", "Company_LinkedIn_Profile", "Company_Phone1", "Company_Phone2",
];

// Fields that belong to MasterDB Contact schema
const CONTACT_FIELDS = [
  "First_Name", "Last_Name", "Full_Name", "Salutation", "Gender",
  "Job_Title", "Job_Seniority", "Job_Seniority_Secondary", "Job_Seniority_Tertiary", "Job_Function",
  "Contact_Direct_Phone1", "Contact_Direct_Phone2", "Mobile_No",
  "Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2",
  "Contact_LinkedIn_Profile",
  "Contact_Address_1", "Contact_Address_2", "Contact_Address_3",
  "Contact_City", "Contact_State", "Contact_Country", "Contact_Region",
  "Contact_Pin", "Contact_STD_ISD_Code", "Contact_Location_Tier",
  "Unsubscribe_Flag", "DND_Flag", "Telecalling_Remarks",
];

const approveOrRejectEditRequest = asyncHandler(async (req, res, next) => {
  try {
    let { status, remarks, callingDataId } = req.body;

    // Normalise callingDataId in case an object is accidentally passed
    if (callingDataId && typeof callingDataId === "object") {
      callingDataId = callingDataId._id || callingDataId.id;
    }

    // Find the pending approval record for this CallingData
    const editRequest = await CallingDataEditApproval.findOne({ callingDataId, status: "Pending" });
    if (!editRequest) return sendError(next, "Edit request not found", 404);

    // Mark approval record status
    editRequest.status = status;
    editRequest.remarks = remarks || [];
    editRequest.approvedorRejectedBy = req.user?._id;
    editRequest.approvedOrRejectedAt = new Date();
    await editRequest.save();

    // Rejected — nothing more to do
    if (status === "Rejected") {
      return sendResponse(res, 200, "Edit request rejected successfully", {
        id: editRequest._id,
        status: editRequest.status,
      });
    }

    // ------------------------------------------------------------------
    // APPROVED — apply the (possibly admin-edited) field values
    // Use remarks array from request (admin may have changed newValues);
    // fall back to the original changedFields stored on the approval record.
    // ------------------------------------------------------------------
    const fieldsToApply =
      Array.isArray(remarks) && remarks.length > 0
        ? remarks
        : editRequest.changedFields;

    // Build a flat { field: newValue } map
    const updatePayload = {};
    fieldsToApply.forEach(({ field, newValue }) => {
      updatePayload[field] = newValue;
    });

    // 1. Update the CallingData document (primary DB)
    const callingData = await CallingData.findByIdAndUpdate(
      callingDataId,
      { $set: updatePayload },
      { new: true }
    );
    if (!callingData) return sendError(next, "Calling data record not found", 404);

    const updatedBy = {
      id: req.user._id,
      name: req.user.employeeName,
      employeeName: req.user.employeeName,
      email: req.user.email,
      mobile: req.user.mobile,
      role: req.user.role,
      designation: req.user.designation,
      location: req.user.location,
    };

    // 2. Update MasterDB Contact using Contact_ID (unique string identifier)
    //    contact_Id is stored on the approval record at the time of request creation
    if (editRequest.contact_Id) {
      const contactUpdate = {};
      fieldsToApply.forEach(({ field, newValue }) => {
        if (CONTACT_FIELDS.includes(field)) contactUpdate[field] = newValue;
      });

      if (Object.keys(contactUpdate).length > 0) {
        const contact = await Contact.findOne({ Contact_ID: editRequest.contact_Id });
        if (contact) {
          const contactChangedFields = fieldsToApply
            .filter(({ field }) => CONTACT_FIELDS.includes(field))
            .map(({ field, oldValue, newValue }) => ({
              field,
              oldValue: oldValue ?? contact[field] ?? "",
              newValue,
            }));
          await ContactHistory.create({
            contact_id: contact._id,
            snapshot: contact.toObject(),
            updatedFields: Object.keys(contactUpdate),
            changedFields: contactChangedFields,
            updatedBy,
            changeType: "update",
          });
          await Contact.findByIdAndUpdate(contact._id, { $set: contactUpdate });
        }
      }
    }

    // 3. Update MasterDB Company using Company_ID from the CallingData record
    if (callingData.Company_ID) {
      const companyUpdate = {};
      fieldsToApply.forEach(({ field, newValue }) => {
        if (COMPANY_FIELDS.includes(field)) companyUpdate[field] = newValue;
      });

      if (Object.keys(companyUpdate).length > 0) {
        const company = await Company.findById(callingData.Company_ID);
        if (company) {
          const companyChangedFields = fieldsToApply
            .filter(({ field }) => COMPANY_FIELDS.includes(field))
            .map(({ field, oldValue, newValue }) => ({
              field,
              oldValue: oldValue ?? company[field] ?? "",
              newValue,
            }));
          await CompanyHistory.create({
            company_id: company._id,
            snapshot: company.toObject(),
            updatedFields: Object.keys(companyUpdate),
            changedFields: companyChangedFields,
            updatedBy,
            changeType: "update",
          });
          await Company.findByIdAndUpdate(company._id, { $set: companyUpdate });
        }
      }
    }

    return sendResponse(res, 200, "Edit request approved and changes applied", {
      id: editRequest._id,
      status: editRequest.status,
    });
  } catch (err) {
    console.error("approveOrRejectEditRequest error:", err);
    return sendError(next, err.message || "Something went wrong", 500);
  }
});

export { getAllPendingEditApprovals, approveOrRejectEditRequest };
