import Invoice from "../models/invoiceModel.js";
import User from "../models/userModel.js";
import Campaign from "../models/campaignModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

/**
 * @desc    Create new invoice with required field checks
 * @route   POST /api/invoices
 * @access  Private
 */
const createInvoice = asyncHandler(async (req, res, next) => {
  try {
    const {
      employeeId,
      campaign_id,
      programManagers,
      startDate,
      endDate,
      month,
    } = req.body;

    // Validate required fields
    if (
      !employeeId ||
      !campaign_id ||
      !programManagers ||
      !startDate ||
      !endDate ||
      !month
    ) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.create(req.body);
    return sendResponse(res, 200, "Invoice created successfully", invoice);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Update invoice
 * @route   PUT /api/invoices/:id
 * @access  Private
 */
const updateInvoice = asyncHandler(async (req, res, next) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("employeeId campaign_id programManagers");

    if (!invoice) return sendError(next, "Invoice not found", 404);

    return sendResponse(
      res,
      200,
      "Invoice updated successfully",
      invoice.toObject()
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Delete invoice
 * @route   DELETE /api/invoices/:id
 * @access  Private
 */
const deleteInvoice = asyncHandler(async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return sendError(next, "Invoice not found", 404);

    await invoice.deleteOne();
    return sendResponse(res, 200, "Invoice deleted successfully", null);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all invoices with optional filters
 * @route   GET /api/invoices
 * @access  Private
 */
const getAllInvoices = asyncHandler(async (req, res, next) => {
  try {
    const { campaign_id, employeeId, programManagerId } = req.query;

    const filter = {};
    if (campaign_id) filter.campaign_id = campaign_id;
    if (employeeId) filter.employeeId = employeeId;
    if (programManagerId) filter.programManagers = programManagerId;

    const invoices = await Invoice.find(filter)
      .populate(
        "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
      )
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get invoices by Program Manager ID (from programManagers array)
 * @route   GET /api/invoices/pm/:pmId
 * @access  Private
 */
const getInvoicesByPMId = asyncHandler(async (req, res, next) => {
  try {
    const pmId = req.params.pmId;

    if (!pmId) {
      return sendError(next, "Program Manager ID is required", 400);
    }

    const invoices = await Invoice.find({ programManagers: pmId })
      .populate(
        "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
      )
      .sort({ createdAt: -1 })
      .lean();

    if (invoices.length === 0) {
      return sendError(next, "No invoices found for this Program Manager", 404);
    }

    return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const generateAllInvoices = asyncHandler(async (req, res, next) => {
  try {
    const { salaryStartDate, salaryEndDate } = req.body;
    if (!salaryStartDate || !salaryEndDate) {
      return sendError(
        next,
        "Salary Start Date and End Date are required",
        400
      );
    }

    const startDateRef = new Date(salaryStartDate);
    const endDateRef = new Date(salaryEndDate);

    const getAllActiveCamapigns = await Campaign.find({
      status: "active",
    })
      .select("_id")
      .lean();
    const activeCampaignsId = getAllActiveCamapigns.map((c) =>
      c._id.toString()
    );

    const agentsData = await AgentAssigned.find({
      campaign_id: { $in: activeCampaignsId },
    })
      .lean()
      .populate({ path: "campaign_id agent_id" });

    const processedData = agentsData.flatMap((assignment) => {
      const campaign = assignment.campaign_id;

      const agentList = Array.isArray(assignment.agent_id)
        ? assignment.agent_id
        : [assignment.agent_id];

      return agentList.map((agent) => {
        const assignedAt = assignment.assignedAt
          ? new Date(assignment.assignedAt)
          : null;

        // FROM DATE LOGIC
        let fromDate = startDateRef;
        if (assignedAt && !isNaN(assignedAt)) {
          fromDate = assignedAt < startDateRef ? startDateRef : assignedAt;
        }

        // TO DATE LOGIC
        let toDate = endDateRef;
        if (assignment.releaseDate) {
          toDate = new Date(assignment.releaseDate);
        } else if (campaign?.end_date) {
          toDate = new Date(campaign.end_date);
        }

        return {
          agentId: agent._id,
          campaignId: campaign._id,
          fromDate,
          toDate,
          agentDetails: agent,
          campaignDetails: campaign,
        };
      });
    });

    //logic for start date and end date

    return sendResponse(res, 200, "Res Retrieved", {
      processedData,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getAllInvoices,
  getInvoicesByPMId,
  generateAllInvoices,
};
