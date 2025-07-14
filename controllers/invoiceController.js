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

//to trigger it on 25th 11pm evey month (so that all the invoices data gets generated)
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

    if (startDateRef > endDateRef) {
      return sendError(next, "Start date must be before End date", 400);
    }

    const campaigns = await Campaign.find({ status: "active" }).lean();
    const campaignIds = campaigns.map((c) => c._id.toString());

    const assignments = await AgentAssigned.find({
      campaign_id: { $in: campaignIds },
    })
      .populate("campaign_id agent_id")
      .lean();

    const invoicesToInsert = [];

    const getDaysInMonth = (date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      return new Date(year, month + 1, 0).getDate();
    };

    for (const assignment of assignments) {
      const agent = assignment.agent_id;
      const campaign = assignment.campaign_id;

      const assignedAt = assignment.assigned_date
        ? new Date(assignment.assigned_date)
        : startDateRef;
      const releasedAt = assignment.released_date
        ? new Date(assignment.released_date)
        : null;

      let fromDate = assignedAt < startDateRef ? startDateRef : assignedAt;
      let toDate = releasedAt
        ? releasedAt
        : campaign?.endDate
        ? new Date(campaign.endDate)
        : endDateRef;

      if (toDate > endDateRef) toDate = endDateRef;

      const msPerDay = 1000 * 60 * 60 * 24;
      const totalDays = Math.floor((toDate - fromDate) / msPerDay) + 1;
      const noOfDaysWorked = totalDays;

      const month = fromDate.toLocaleString("default", {
        month: "long",
        year: "numeric",
      });

      const existingInvoice = await Invoice.findOne({
        employeeId: agent._id,
        campaign_id: campaign._id,
        month,
        startDate: { $eq: fromDate },
        endDate: { $eq: toDate },
      });

      if (existingInvoice) continue;

      const totalDaysInMonth = getDaysInMonth(fromDate);
      const daysAvailable = totalDaysInMonth - noOfDaysWorked;

      const invoice = {
        employeeId: agent._id,
        campaign_id: campaign._id,
        isMultiCampaign: false,
        programManagers: campaign.programManager,
        startDate: fromDate,
        endDate: toDate,
        month,
        noOfDaysWorked,
        noOfDaysAbsent: 0,
        incentive: 0,
        arrears: 0,
        extraPay: 0,
        salaryGenBy: req.user?._id || null,
        totalDaysGenerated: totalDays,
        daysAvailabletoGenerate: daysAvailable < 0 ? 0 : daysAvailable,
        invoiceGenerated: {
          status: false,
          genBy: null,
          invoiceUrl: "",
        },
      };

      invoicesToInsert.push(invoice);
    }

    if (invoicesToInsert.length > 0) {
      await Invoice.insertMany(invoicesToInsert);
    }

    return sendResponse(res, 200, "Invoices generated successfully", {
      totalInvoices: invoicesToInsert.length,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

//to get all the invoices of the user for the specific month
const getAgentInvoicesDataByMonth = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, month } = req.query;
    console.log(agentId, "agentId");
    if (!agentId || !month) {
      return sendError(next, "Agent ID and month are required", 400);
    }

    const normalizedMonth = month
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const invoices = await Invoice.find({
      employeeId: agentId,
      month: normalizedMonth,
    })
      .populate({
        path: "employeeId",
        select: "-password -__v -createdAt -updatedAt",
      })
      .populate({
        path: "campaign_id",
        select: "-__v -createdAt -updatedAt",
        populate: {
          path: "programManager",
          select: "-password -__v -createdAt -updatedAt",
        },
      })
      .populate({
        path: "programManagers",
        select: "-password -__v -createdAt -updatedAt",
      })
      .populate({
        path: "salaryGenBy",
        select: "employeeName email role",
      })
      .populate({
        path: "salaryModBy",
        select: "employeeName email role",
      })
      .lean();

    return sendResponse(res, 200, "Invoices fetched successfully", invoices);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

//need to check and modify
const updateAndGenerateInvoice = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      incentive = 0,
      arrears = 0,
      extraPay = 0,
      noOfDaysWorked,
      noOfDaysAbsent = 0,
      startDate,
      endDate,
      salaryModBy,
      ctc,
    } = req.body;

    if (!invoiceId || !noOfDaysWorked || !startDate || !endDate || !ctc) {
      return sendError(next, "Missing required fields", 400);
    }

    const gross = Math.round((ctc / 30) * noOfDaysWorked);

    const finalCTC =
      gross + Number(incentive) + Number(arrears) + Number(extraPay);

    const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
    const daysAvailabletoGenerate = 30 - noOfDaysWorked;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return sendError(next, "Invoice not found", 404);

    invoice.incentive = incentive;
    invoice.arrears = arrears;
    invoice.extraPay = extraPay;
    invoice.noOfDaysWorked = noOfDaysWorked;
    invoice.noOfDaysAbsent = noOfDaysAbsent;
    invoice.startDate = new Date(startDate);
    invoice.endDate = new Date(endDate);
    invoice.salaryModBy = salaryModBy;
    invoice.totalDaysGenerated = totalDaysGenerated;
    invoice.daysAvailabletoGenerate = daysAvailabletoGenerate;
    invoice.ctc = finalCTC;

    await invoice.save();

    return sendResponse(res, 200, "Invoice updated successfully", {
      finalCTC,
      invoice,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

//to get all agents to show it in dropdown
const getAgentsByProgramManager = asyncHandler(async (req, res, next) => {
  try {
    const { programManagerId } = req.params;

    if (!programManagerId) {
      return sendError(next, "Program Manager ID is required", 400);
    }

    const campaigns = await Campaign.find({ programManager: programManagerId })
      .select("_id")
      .lean();
    const campaignIds = campaigns.map((c) => c._id.toString());

    if (!campaignIds.length) {
      return sendResponse(
        res,
        200,
        "No campaigns found for this Program Manager",
        []
      );
    }

    const assignments = await AgentAssigned.find({
      campaign_id: { $in: campaignIds },
    })
      .populate("agent_id", "employeeName email role ctc programName status")
      .populate("campaign_id", "name startDate endDate");

    const agentDetails = assignments.map((a) => ({
      agentId: a.agent_id?._id,
      employeeName: a.agent_id?.employeeName,
      email: a.agent_id?.email,
      role: a.agent_id?.role,
      ctc: a.agent_id?.ctc,
      programName: a.agent_id?.programName,
      status: a.agent_id?.status,
      campaignName: a.campaign_id?.name,
      campaignId: a.campaign_id?._id,
      campaignStartDate: a.campaign_id?.startDate,
      campaignEndDate: a.campaign_id?.endDate,
      assignedDate: a.assigned_date,
      releasedDate: a.released_date,
    }));

    return sendResponse(
      res,
      200,
      "Agents retrieved successfully",
      agentDetails
    );
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
  getAgentInvoicesDataByMonth,
  updateAndGenerateInvoice,
  getAgentsByProgramManager,
};
