import mongoose from "mongoose";
import Invoice from "../models/invoiceModel.js";
import Campaign from "../models/campaignModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import Attendance from "../models/attendenceModel.js";
import errorHandler from "../utils/index.js";
import PDFDocument from "pdfkit";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import https from "https";
import uploadFile from "../services/aws-helper.js";
import UploadedFiles from "../models/uploadFilesModel.js";
import pkg from "number-to-words";
const { toWords } = pkg;

const { asyncHandler, sendError, sendResponse } = errorHandler;

function countWeekdays(start, end) {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endD = new Date(end);
  endD.setHours(23, 59, 59, 999);
  while (cur <= endD) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function getAttendanceSummary(userId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const attendanceRecords = await Attendance.find({
    userId,
    loginDate: { $gte: start, $lte: end },
  }).lean();

  const presentDatesSet = new Set(
    attendanceRecords.map((rec) => rec.loginDate.toISOString().slice(0, 10))
  );

  let totalCalendarDays = 0;
  let totalWorkingDays = 0; // Mon–Fri only
  const presentDates = [];
  const absentDates = [];

  let current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const day = current.getDay(); // 0=Sun, 6=Sat
    totalCalendarDays++;

    if (day !== 0 && day !== 6) {
      // Weekday only
      totalWorkingDays++;
      if (presentDatesSet.has(dateStr)) {
        presentDates.push(dateStr);
      } else {
        absentDates.push(dateStr);
      }
    }

    current.setDate(current.getDate() + 1);
  }

  const presentDays = presentDates.length;
  const absentDays = absentDates.length; // weekday absences
  const forgivenAbsent = Math.min(1, absentDays); // 1 free leave
  const effectiveAbsent = Math.max(0, absentDays - forgivenAbsent);
  const payableDays = totalWorkingDays - effectiveAbsent;

  return {
    totalCalendarDays,
    totalWorkingDays,
    presentDays,
    absentDays,
    forgivenAbsent,
    effectiveAbsent,
    payableDays,
    presentDates,
    absentDates,
  };
}

const insertSignatureFromUrl = (url, doc, x, y, width, height) => {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response
        .on("data", (chunk) => chunks.push(chunk))
        .on("end", () => {
          const buffer = Buffer.concat(chunks);
          try {
            doc.image(buffer, x, y, { width, height });
            resolve();
          } catch (err) {
            reject(err);
          }
        })
        .on("error", reject);
    });
  });
};
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
 * @desc    Get all invoices of a pm with optional filters
 * @route   GET /api/invoices
 * @access  Private
 */
const getAllInvoices = asyncHandler(async (req, res, next) => {
  try {
    const { campaign_id, employeeId, programManagerId } = req.query;
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    const filter = {};
    if (campaign_id) filter.campaign_id = campaign_id;
    if (employeeId) filter.employeeId = employeeId;
    if (programManagerId) filter.programManagers = programManagerId;

    if (!page) {
      const invoices = await Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .lean();
      return sendResponse(
        res,
        200,
        "Invoices retrieved successfully",
        invoices
      );
    }

    const skip = (page - 1) * limit;
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Invoices retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: invoices,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all invoices data with optional filters
 * @route   GET /api/invoices
 * @access  Private
 */
const getAllInvoicesData = asyncHandler(async (req, res, next) => {
  try {
    const { month } = req.query;
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    if (!month) {
      return sendError(next, "Month is required", 400);
    }

    if (!page) {
      const invoices = await Invoice.find({ month })
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .lean();
      return sendResponse(
        res,
        200,
        "Invoices retrieved successfully",
        invoices
      );
    }

    const skip = (page - 1) * limit;
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments({ month }),
      Invoice.find({ month })
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Invoices retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: invoices,
    });
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
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    if (!pmId) {
      return sendError(next, "Program Manager ID is required", 400);
    }

    if (!page) {
      const invoices = await Invoice.find({ programManagers: pmId })
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .lean();

      if (invoices.length === 0) {
        return sendError(
          next,
          "No invoices found for this Program Manager",
          404
        );
      }
      return sendResponse(
        res,
        200,
        "Invoices retrieved successfully",
        invoices
      );
    }

    const skip = (page - 1) * limit;
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments({ programManagers: pmId }),
      Invoice.find({ programManagers: pmId })
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Invoices retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: invoices,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// here
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
      isAssigned: true,
    })
      .populate("campaign_id agent_id")
      .lean();

    console.log(
      `[INFO] Found ${assignments.length} active assignments across ${campaigns.length} active campaigns`
    );

    // Use fixed month names to avoid locale differences between server and client
    const MONTH_NAMES = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = `${
      MONTH_NAMES[endDateRef.getMonth()]
    } ${endDateRef.getFullYear()}`;
    const monthWorkingDays = countWeekdays(startDateRef, endDateRef);

    console.log(
      `[INFO] Month label: "${month}", Cycle working days: ${monthWorkingDays}`
    );

    const invoicesToInsert = [];
    let skippedCount = 0;

    for (const assignment of assignments) {
      const agent = assignment.agent_id;
      const campaign = assignment.campaign_id;

      if (!agent || !campaign) continue;

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

      const attendanceSummary = await getAttendanceSummary(
        agent._id,
        fromDate,
        toDate
      );

      const {
        presentDays,
        absentDays,
        totalWorkingDays,
        forgivenAbsent,
        effectiveAbsent,
        payableDays,
        totalCalendarDays,
      } = attendanceSummary;
      const agentCtc = agent.ctc || 0;
      const salary =
        monthWorkingDays > 0
          ? Math.round((agentCtc / monthWorkingDays) * payableDays)
          : 0;

      const existingInvoice = await Invoice.findOne({
        employeeId: agent._id,
        campaign_id: campaign._id,
        month,
      });

      if (existingInvoice) {
        skippedCount++;
        continue;
      }

      const invoice = {
        employeeId: agent._id,
        campaign_id: campaign._id,
        isMultiCampaign: false,
        programManagers: campaign.programManager || [],
        startDate: fromDate,
        endDate: toDate,
        month,
        noOfDaysWorked: presentDays,
        noOfDaysAbsent: absentDays,
        totalWorkingDays,
        monthWorkingDays,
        forgivenAbsent,
        effectiveAbsent,
        payableDays,
        ctc: agentCtc,
        incentive: 0,
        arrears: 0,
        extraPay: 0,
        salaryGenBy: req.user?._id || null,
        totalDaysGenerated: totalCalendarDays,
        daysAvailabletoGenerate: 0,
        invoiceGenerated: {
          status: false,
          genBy: null,
          invoiceUrl: "",
        },
        salary,
      };

      invoicesToInsert.push(invoice);
    }

    let insertedCount = 0;

    if (invoicesToInsert.length > 0) {
      await Invoice.insertMany(invoicesToInsert, { ordered: false })
        .then((docs) => {
          insertedCount = docs.length;
        })
        .catch((err) => {
          if (err.code === 11000) {
            console.warn("Some duplicate invoices were skipped.");
          } else {
            throw err;
          }
        });
    }

    console.log(
      `[INFO] Inserted: ${insertedCount}, Skipped (already exist): ${skippedCount}`
    );

    return sendResponse(res, 200, "Invoices generated successfully", {
      totalInvoicesAttempted: invoicesToInsert.length,
      successfullyInserted: insertedCount,
      alreadyExisted: skippedCount,
      month,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const runInvoiceGeneration = asyncHandler(async () => {
  try {
    console.log(">>> Invoice generation started...");

    //Calculate  26th-25th cycle
    const now = new Date();
    const istNow = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );

    const year = istNow.getFullYear();
    const month = istNow.getMonth();

    // Correct date format (26th of current month to 25th of next month)
    const salaryStartDate = new Date(year, month, 26)
      .toISOString()
      .split("T")[0];

    const salaryEndDate = new Date(year, month + 1, 25)
      .toISOString()
      .split("T")[0];

    console.log(`[INFO] Salary cycle: ${salaryStartDate} → ${salaryEndDate}`);

    const startDateRef = new Date(salaryStartDate);
    const endDateRef = new Date(salaryEndDate);

    //  Validate date range
    if (startDateRef > endDateRef) {
      throw new Error("Start date must be before End date");
    }

    //  Fetch active campaigns
    const campaigns = await Campaign.find({ status: "active" }).lean();
    const campaignIds = campaigns.map((c) => c._id.toString());

    if (campaignIds.length === 0) {
      console.log(">>> No active campaigns found.");
      return {
        success: true,
        salaryStartDate,
        salaryEndDate,
        totalInvoicesAttempted: 0,
        successfullyInserted: 0,
      };
    }

    const assignments = await AgentAssigned.find({
      campaign_id: { $in: campaignIds },
    })
      .populate("campaign_id agent_id")
      .lean();

    const invoicesToInsert = [];

    //  Loop through assignments with proper data
    for (const assignment of assignments) {
      const agent = assignment.agent_id;
      const campaign = assignment.campaign_id;

      if (!agent || !campaign) continue;

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

      const attendanceSummary = await getAttendanceSummary(
        agent._id,
        fromDate,
        toDate
      );

      const {
        presentDays,
        absentDays,
        totalWorkingDays,
        forgivenAbsent,
        effectiveAbsent,
        payableDays,
        totalCalendarDays,
      } = attendanceSummary;
      const agentCtc = agent.ctc || 0;
      const monthWorkingDays = countWeekdays(startDateRef, endDateRef);
      const salary =
        monthWorkingDays > 0
          ? Math.round((agentCtc / monthWorkingDays) * payableDays)
          : 0;

      // Use END date of cycle as month label — fixed format to avoid locale differences
      const _MONTHS = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const month = `${
        _MONTHS[endDateRef.getMonth()]
      } ${endDateRef.getFullYear()}`;

      //  Check for duplicate invoice
      const existingInvoice = await Invoice.findOne({
        employeeId: agent._id,
        campaign_id: campaign._id,
        month,
      });

      if (existingInvoice) continue;

      invoicesToInsert.push({
        employeeId: agent._id,
        campaign_id: campaign._id,
        isMultiCampaign: false,
        programManagers: campaign.programManager,
        startDate: fromDate,
        endDate: toDate,
        month,
        noOfDaysWorked: presentDays,
        noOfDaysAbsent: absentDays,
        totalWorkingDays,
        monthWorkingDays,
        forgivenAbsent,
        effectiveAbsent,
        payableDays,
        ctc: agentCtc,
        incentive: 0,
        arrears: 0,
        extraPay: 0,
        salaryGenBy: null, // cron = system
        totalDaysGenerated: totalCalendarDays,
        daysAvailabletoGenerate: 0,
        invoiceGenerated: {
          status: false,
          genBy: null,
          invoiceUrl: "",
        },
        salary,
      });
    }

    // Insert invoices with proper error handling
    let insertedCount = 0;

    if (invoicesToInsert.length > 0) {
      await Invoice.insertMany(invoicesToInsert, { ordered: false })
        .then((docs) => {
          insertedCount = docs.length;
        })
        .catch((err) => {
          if (err.code === 11000) {
            console.warn("Some duplicate invoices were skipped.");
          } else {
            throw err;
          }
        });
    }

    console.log(">>> Invoice generation completed.");
    console.log(`>>> Total attempted: ${invoicesToInsert.length}`);
    console.log(`>>> Successfully inserted: ${insertedCount}`);

    return {
      success: true,
      salaryStartDate,
      salaryEndDate,
      totalInvoicesAttempted: invoicesToInsert.length,
      successfullyInserted: insertedCount,
    };
  } catch (error) {
    console.error(">>> Invoice generation error:", error);
    throw error;
  }
});

//to get all the invoices of the user for the specific month
const getAgentInvoicesDataByMonth = asyncHandler(async (req, res, next) => {
  try {
    const { agentId, month } = req.query;
    if (!agentId || !month) {
      return sendError(next, "Agent ID and month are required", 400);
    }

    const normalizedMonth = month
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const invoices = await Invoice.find({
      employeeId: agentId,
      month: month,
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

const updateAndGenerateInvoice = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      agentId, // used to auto-create invoice if invoiceId missing
      campaignId,
      month,
      ctc,
      incentive,
      arrears,
      extraPay,
      noOfDaysWorked, // payable days for this campaign (direct)
      noOfDaysAbsent, // stored for record keeping
      noOfDaysPresent, // manually overridden present days
      forgivenAbsent, // manually overridden forgiven absences
      monthWorkingDays: payloadMonthWorkingDays,
      startDate,
      endDate,
      genBy,
      salaryModBy,
    } = req.body;

    if (!startDate || !endDate || ctc === undefined || ctc === null || !genBy) {
      return sendError(next, "Missing required fields", 400);
    }

    let invoice;
    if (invoiceId) {
      invoice = await Invoice.findById(invoiceId).populate("employeeId");
    } else if (agentId && campaignId && month) {
      // Find or create invoice record
      invoice = await Invoice.findOne({
        employeeId: agentId,
        campaign_id: campaignId,
        month,
      }).populate("employeeId");
      if (!invoice) {
        const campaign = await Campaign.findById(campaignId)
          .select("programManager")
          .lean();
        const created = await Invoice.create({
          employeeId: agentId,
          campaign_id: campaignId,
          month,
          programManagers: campaign?.programManager || [],
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          salary: 0,
          salaryGenBy: req.user?._id || genBy,
        });
        invoice = await Invoice.findById(created._id).populate("employeeId");
      }
    } else {
      return sendError(
        next,
        "Either invoiceId or (agentId, campaignId, month) required",
        400
      );
    }

    if (!invoice) return sendError(next, "Invoice not found", 404);

    const employee = invoice.employeeId;
    if (!employee) return sendError(next, "Employee not found", 404);

    // noOfDaysWorked IS the payable days for this campaign (PM sets it directly)
    const monthWorkingDays =
      Number(payloadMonthWorkingDays) || Number(invoice.monthWorkingDays) || 0;
    const payableDays = Number(noOfDaysWorked) || 0;
    const dailyRate = monthWorkingDays > 0 ? Number(ctc) / monthWorkingDays : 0;
    const gross = Math.round(dailyRate * payableDays);
    const finalCTC =
      gross +
      Number(incentive || 0) +
      Number(arrears || 0) +
      Number(extraPay || 0);

    // Update invoice fields
    invoice.ctc = Number(ctc);
    invoice.noOfDaysWorked = payableDays;
    invoice.noOfDaysAbsent = Number(noOfDaysAbsent || 0);
    invoice.noOfDaysPresent = Number(noOfDaysPresent ?? noOfDaysWorked ?? 0);
    invoice.forgivenAbsent = Number(forgivenAbsent ?? 0);
    invoice.monthWorkingDays = monthWorkingDays;
    invoice.payableDays = payableDays;
    invoice.incentive = Number(incentive || 0);
    invoice.arrears = Number(arrears || 0);
    invoice.extraPay = Number(extraPay || 0);
    invoice.startDate = new Date(startDate);
    invoice.endDate = new Date(endDate);
    invoice.salaryModBy = salaryModBy;
    invoice.daysAvailabletoGenerate = 0;
    if (!invoice.invoiceGenerated) invoice.invoiceGenerated = {};
    invoice.invoiceGenerated.genBy = genBy;
    invoice.salary = gross;

    // Persist all field updates immediately — independent of PDF generation
    await invoice.save();

    // Generate PDF in memory
    const pdfFilename = `invoice-${invoice._id}-${Date.now()}.pdf`;
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    // Store PDF data in memory
    const pdfBuffers = [];
    doc.on("data", (chunk) => {
      pdfBuffers.push(chunk);
    });

    // ── Helpers ──────────────────────────────────────────────────────────────
    const _ed = new Date(endDate);
    const _lastCal = new Date(_ed.getFullYear(), _ed.getMonth() + 1, 0);
    const lastDayStr = _lastCal.toLocaleDateString("en-GB");
    const invoiceMonth = _ed.toLocaleString("default", { month: "long" });
    const invoiceYear = _ed.getFullYear();
    const fy = `${invoiceYear}-${invoiceYear + 1}`;
    const agentName = employee.employeeName || "Agent";

    // ── Layout ───────────────────────────────────────────────────────────────
    const L = 20; // left edge
    const W = 555; // total width
    const MX = L + 10; // content left padding
    const COL = W / 2; // 277.5 — column width
    const R2 = L + COL; // right column x = 297.5

    // ── OUTER BORDER ─────────────────────────────────────────────────────────
    doc.lineWidth(1).strokeColor("#333");
    doc.rect(L, 15, W, 808).stroke();

    // ── HEADER  y=15 h=40 → 55 ───────────────────────────────────────────────
    doc.rect(L, 15, W, 40).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("INVOICE", L, 24, { align: "center", width: W });
    doc.fillColor("#000");

    // ── FROM (left) + CONTACT (right)  y=55 h=130 → 185 ─────────────────────
    doc.lineWidth(1).strokeColor("#333");
    doc.rect(L, 55, COL, 130).stroke();
    doc.rect(R2, 55, W - COL, 130).stroke();

    doc.font("Helvetica-Bold").fontSize(10).text("From :", MX, 65);
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(agentName, MX + 45, 65);
    doc.font("Helvetica-Bold").text("Employee Code:", MX, 85);
    doc.font("Helvetica").text(employee.employeeCode || "N/A", MX + 90, 85);
    doc.font("Helvetica-Bold").text("Address:", MX, 105);
    doc
      .font("Helvetica")
      .text(employee.location || "N/A", MX + 55, 105, { width: COL - 65 });

    doc.font("Helvetica-Bold").text("Contact Number:", R2 + 10, 65);
    doc.font("Helvetica").text(employee.mobile || "N/A", R2 + 105, 65);
    doc.font("Helvetica-Bold").text("Mobile Number:", R2 + 10, 82);
    doc.font("Helvetica").text(employee.mobile || "N/A", R2 + 100, 82);
    doc.font("Helvetica-Bold").text("Permanent Account Number:", R2 + 10, 99);
    doc.font("Helvetica").text(employee.pan || "N/A", R2 + 168, 99);
    doc.font("Helvetica-Bold").text("GSTIN Number:", R2 + 10, 116);
    doc.font("Helvetica").text(employee.gstin || "N/A", R2 + 92, 116);

    // ── TO (left) + INVOICE INFO (right)  y=185 h=95 → 280 ──────────────────
    doc.rect(L, 185, COL, 95).stroke();
    doc.rect(R2, 185, W - COL, 95).stroke();

    doc.font("Helvetica-Bold").text("TO", MX, 196);
    doc
      .font("Helvetica")
      .text("Kestone IMS – A Division of CL Educate Limited", MX + 22, 196, {
        width: COL - 32,
      });
    doc
      .font("Helvetica")
      .text(
        "#37, 7th Cross, RMJ Mandoth Towers, 3rd Floor, Vasanth Nagar, Bangalore-5600052",
        MX,
        218,
        { width: COL - 15 }
      );

    doc.font("Helvetica-Bold").text("Invoice No :", R2 + 10, 196);
    doc
      .font("Helvetica")
      .text(String(invoice._id).slice(-12).toUpperCase(), R2 + 80, 196);
    doc.font("Helvetica-Bold").text("FY :", R2 + 10, 216);
    doc.font("Helvetica").text(`${fy} / ${invoiceMonth}`, R2 + 30, 216);
    doc.font("Helvetica-Bold").text("Date :", R2 + 10, 236);
    doc.font("Helvetica").text(lastDayStr, R2 + 45, 236);
    doc.font("Helvetica-Bold").text("GSTIN No :", R2 + 10, 256);
    doc.font("Helvetica").text("29AACCB3885C2ZO", R2 + 72, 256);

    // ── PARTICULARS TABLE HEADER  y=280 h=35 → 315 ───────────────────────────
    doc.rect(L, 280, 370, 35).fillAndStroke("#666", "#333");
    doc.rect(L + 370, 280, 185, 35).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("PARTICULARS", MX, 291, { width: 355 })
      .text("AMOUNT (Rs)", L + 370, 291, { width: 180, align: "right" });
    doc.fillColor("#000");

    // ── PARTICULARS TABLE BODY  y=315 h=200 → 515 ────────────────────────────
    doc.lineWidth(1).strokeColor("#333");
    doc.rect(L, 315, 370, 200).stroke();
    doc.rect(L + 370, 315, 185, 200).stroke();

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Professional Charges for the M/O ${invoiceMonth}' ${invoiceYear} for rendering services as per below detail`,
        MX,
        322,
        { width: 355 }
      );
    doc.text(`Gross Fees: INR. ${gross}/-`, MX, 360);
    doc.text(`Incentive or other payment: ${incentive}`, MX, 380);
    doc.text(`Extra Pay: ${extraPay}`, MX, 400);
    doc.text(`Arrears: ${arrears}`, MX, 420);

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(`INR. ${finalCTC}/-`, L + 370, 390, { width: 180, align: "right" });

    // ── TOTAL AMOUNT PAYABLE  y=515 h=40 → 555 ───────────────────────────────
    doc.rect(L, 515, 370, 40).fillAndStroke("#666", "#333");
    doc.rect(L + 370, 515, 185, 40).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("TOTAL AMOUNT PAYABLE", MX, 529, { width: 355 })
      .text(`INR. ${finalCTC}/-`, L + 370, 529, { width: 180, align: "right" });
    doc.fillColor("#000");

    // ── AMOUNT IN WORDS  y=555 h=40 → 595 ────────────────────────────────────
    doc.rect(L, 555, W, 40).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`AMOUNT IN WORDS : ${finalCTC} ONLY`, MX, 569, { width: W - 20 });
    doc.fillColor("#000");

    // ── SIGNATURE BOXES  y=595 h=228 → 823 ───────────────────────────────────
    doc.lineWidth(1).strokeColor("#333");
    doc.rect(L, 595, COL, 228).stroke();
    doc.rect(R2, 595, W - COL, 228).stroke();

    // Left box — SIGNATURE label at top, image centered in remaining space
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`SIGNATURE - ${agentName}`, MX, 605);

    try {
      await insertSignatureFromUrl(
        employee?.signature,
        doc,
        MX + 10,
        670,
        140,
        100
      );
    } catch (signatureError) {
      console.error("Signature insertion failed:", signatureError);
    }

    // Right box — NAME, DATE centered
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`NAME - ${agentName}`, R2, 695, { width: W - COL, align: "center" })
      .text(`DATE - ${lastDayStr}`, R2, 712, {
        width: W - COL,
        align: "center",
      });

    doc.end();

    doc.on("end", async () => {
      try {
        // Combine all PDF chunks into a single buffer
        const pdfBuffer = Buffer.concat(pdfBuffers);

        if (!pdfBuffer || pdfBuffer.length === 0) {
          throw new Error("PDF buffer is empty or corrupted");
        }

        console.log(
          `PDF generated successfully in memory, Size: ${pdfBuffer.length} bytes`
        );

        const mimeType = "application/pdf";
        const type = "pdf";

        // Clean filename for AWS upload
        const cleanFileName = pdfFilename.replace(/\s+/g, "");
        const uploadFileName = `${Date.now()}_${cleanFileName}`;

        console.log("Uploading PDF to AWS S3...");

        // Upload to AWS S3
        const AWSBucket = process.env.AWS_BUCKET_NAME;
        const awsUpload = await uploadFile(
          `${AWSBucket}/${type}`,
          pdfBuffer,
          uploadFileName,
          mimeType
        );

        if (!awsUpload.src) {
          throw new Error(
            "AWS upload failed: No URL returned from upload service"
          );
        }

        console.log("AWS Upload successful:", awsUpload.src);

        // Save file details to database
        const userId = genBy; // Using genBy as userId since that's who generated the invoice
        const uploadedFileRecord = new UploadedFiles({
          userId,
          type,
          subtype: "invoice",
          fileSrc: awsUpload.src,
          extension: "pdf",
          originalName: pdfFilename,
          mimeType: mimeType,
        });

        const savedFileRecord = await uploadedFileRecord.save();
        console.log("File record saved to database:", savedFileRecord._id);

        // Update invoice with the uploaded URL
        invoice.invoiceGenerated.invoiceUrl = awsUpload.src;
        invoice.invoiceGenerated.status = true;
        await invoice.save();

        return sendResponse(
          res,
          200,
          "Invoice updated, generated and uploaded",
          {
            invoice,
            finalCTC,
            uploadedUrl: awsUpload.src,
            fileRecord: savedFileRecord,
          }
        );
      } catch (uploadErr) {
        console.error("Upload error details:", uploadErr);
        return sendError(next, `Upload failed: ${uploadErr.message}`, 500);
      }
    });

    doc.on("error", (err) => {
      console.error("PDF generation error:", err);
      return sendError(next, `PDF generation failed: ${err.message}`, 500);
    });
  } catch (error) {
    console.error("Controller error:", error);
    return sendError(next, error.message, 500);
  }
});

const getAgentsByProgramManager = asyncHandler(async (req, res, next) => {
  try {
    const { programManagerId, month } = req.params;

    if (!programManagerId || !month) {
      return sendError(next, "Program Manager ID and month are required", 400);
    }

    const invoices = await Invoice.find({
      programManagers: { $in: [new mongoose.Types.ObjectId(programManagerId)] },
      month,
    })
      .populate("employeeId", "employeeName email role ctc programName status")
      .lean();

    const uniqueAgentsMap = new Map();

    for (const invoice of invoices) {
      const agent = invoice.employeeId;
      if (agent && !uniqueAgentsMap.has(agent._id.toString())) {
        uniqueAgentsMap.set(agent._id.toString(), {
          agentId: agent._id,
          employeeName: agent.employeeName,
          email: agent.email,
          role: agent.role,
          ctc: agent.ctc,
          programName: agent.programName,
          status: agent.status,
        });
      }
    }

    const uniqueAgents = Array.from(uniqueAgentsMap.values());

    return sendResponse(res, 200, "Unique agents retrieved", uniqueAgents);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const getInvoicesByPMAndMonth = asyncHandler(async (req, res, next) => {
  try {
    const { pmId } = req.params;
    const { month } = req.query;
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    if (!pmId || !month) {
      return sendError(next, "Program Manager ID and month are required", 400);
    }

    const normalizedMonth = month.trim();
    const filter = {
      programManagers: new mongoose.Types.ObjectId(pmId),
      month: normalizedMonth,
      "invoiceGenerated.status": true,
    };

    if (!page) {
      const invoices = await Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .lean();
      return sendResponse(
        res,
        200,
        "Invoices retrieved successfully",
        invoices
      );
    }

    const skip = (page - 1) * limit;
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Invoices retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: invoices,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getInvoicesOfAgent = asyncHandler(async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    if (!agentId) {
      return sendError(next, "Agent ID is required", 400);
    }

    const filter = {
      employeeId: agentId,
      "invoiceGenerated.invoiceUrl": { $exists: true, $ne: null },
    };

    if (!page) {
      const invoices = await Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .lean();
      return sendResponse(
        res,
        200,
        "Invoices retrieved successfully",
        invoices
      );
    }

    const skip = (page - 1) * limit;
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .populate(
          "employeeId campaign_id programManagers salaryGenBy salaryModBy invoiceGenerated.genBy"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Invoices retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: invoices,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
// for exporting excel sheet with all invoices of a program manager month wise
const getAllInvoicesOfPmMonthWise = asyncHandler(async (req, res, next) => {
  try {
    const { pmId, month } = req.params;

    if (!pmId || !month) {
      return sendError(next, "Program Manager ID and month are required", 400);
    }

    // const parsedMonth = month.replace(/([a-zA-Z]+)(\d{4})/, "$1 $2");
    // console.log("Parsed Month:", parsedMonth == "June 2025");

    const invoices = await Invoice.find({
      programManagers: { $in: [new mongoose.Types.ObjectId(pmId)] },
      month,
      "invoiceGenerated.invoiceUrl": { $nin: [null, ""] },
    })
      .populate({
        path: "employeeId",
        select: "-password -__v -createdAt -updatedAt -signature ",
      })
      .populate({
        path: "campaign_id",
        select: "-__v -createdAt -updatedAt -programManager",
        populate: {
          path: "programManager",
          // select: "-password -__v -createdAt -updatedAt ",
          select: "_id employeeName email location ",
        },
      })
      // .populate({
      //   path: "programManagers",
      //   select: "-password -__v -createdAt -updatedAt",
      // })
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

// ─── Salary Dashboard ──────────────────────────────────────────────────────────
// Returns per-agent attendance summary + existing invoice status for PM's cycle
const getSalaryDashboard = asyncHandler(async (req, res, next) => {
  try {
    const { pmId, month } = req.query;
    if (!pmId || !month)
      return sendError(next, "pmId and month are required", 400);

    const parts = month.trim().split(" ");
    if (parts.length !== 2)
      return sendError(
        next,
        "month must be 'Month Year' e.g. 'June 2026'",
        400
      );
    const [monthName, yearStr] = parts;
    const year = parseInt(yearStr, 10);
    const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth(); // 0-indexed

    // Salary cycle: 26th of prev month → 25th of this month
    const cycleStart = new Date(year, monthIndex - 1, 26, 0, 0, 0, 0);
    const cycleEnd = new Date(year, monthIndex, 25, 23, 59, 59, 999);
    const cycleStartStr = `${cycleStart.getFullYear()}-${String(
      cycleStart.getMonth() + 1
    ).padStart(2, "0")}-26`;
    const cycleEndStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-25`;
    const totalWorkingDays = countWeekdays(cycleStart, cycleEnd);
    const totalCalendarDays =
      Math.floor(
        (new Date(year, monthIndex, 25) - new Date(year, monthIndex - 1, 26)) /
          (24 * 60 * 60 * 1000)
      ) + 1;

    // Campaigns under this PM
    const campaigns = await Campaign.find({ programManager: pmId })
      .select("_id name jcNumber")
      .lean();
    const campaignIds = campaigns.map((c) => c._id);
    if (!campaignIds.length) {
      return sendResponse(res, 200, "No campaigns found", {
        agents: [],
        totalWorkingDays,
        totalCalendarDays,
        cycleStart: cycleStartStr,
        cycleEnd: cycleEndStr,
        month,
      });
    }

    // Active agent assignments for these campaigns
    const assignments = await AgentAssigned.find({
      campaign_id: { $in: campaignIds },
      isAssigned: true,
    })
      .populate({ path: "agent_id", select: "employeeName employeeCode ctc" })
      .lean();

    if (!assignments.length) {
      return sendResponse(res, 200, "No agents found", {
        agents: [],
        totalWorkingDays,
        totalCalendarDays,
        cycleStart: cycleStartStr,
        cycleEnd: cycleEndStr,
        month,
      });
    }

    const campaignMap = Object.fromEntries(
      campaigns.map((c) => [c._id.toString(), c])
    );
    const agentIds = [
      ...new Set(
        assignments.map((a) => a.agent_id?._id?.toString()).filter(Boolean)
      ),
    ];

    // Fetch attendance records for all agents in the cycle
    const attendanceRecords = await Attendance.find({
      employeeId: { $in: agentIds },
      createdAt: { $gte: cycleStart, $lte: cycleEnd },
    })
      .sort({ createdAt: 1 })
      .lean();

    // Build per-agent map: { agentId: { "YYYY-MM-DD": ISOString of first login } }
    const agentAttMap = {};
    for (const rec of attendanceRecords) {
      const aId = rec.employeeId.toString();
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date(rec.createdAt));
      if (!agentAttMap[aId]) agentAttMap[aId] = {};
      if (!agentAttMap[aId][istDate]) agentAttMap[aId][istDate] = rec.createdAt;
    }

    // All invoices for these agents this month (to compute already-generated payable days)
    const existingInvoices = await Invoice.find({
      employeeId: { $in: agentIds },
      month,
    })
      .populate({ path: "invoiceGenerated.genBy", select: "employeeName" })
      .lean();

    // Per-agent total payable days already generated across ALL campaigns this month
    const agentGenDays = {};
    for (const inv of existingInvoices) {
      const aId = inv.employeeId.toString();
      agentGenDays[aId] = (agentGenDays[aId] || 0) + (inv.payableDays || 0);
    }

    const agents = [];
    for (const asgn of assignments) {
      const agent = asgn.agent_id;
      if (!agent) continue;
      const aId = agent._id.toString();
      const campaign = campaignMap[asgn.campaign_id?.toString()];
      if (!campaign) continue;

      // Agent's effective period clipped to the cycle
      const assignedAt = asgn.assigned_date
        ? new Date(asgn.assigned_date)
        : cycleStart;
      const releasedAt = asgn.released_date
        ? new Date(asgn.released_date)
        : null;
      const fromDate =
        assignedAt < cycleStart ? new Date(cycleStart) : new Date(assignedAt);
      let toDate = releasedAt ? new Date(releasedAt) : new Date(cycleEnd);
      if (toDate > cycleEnd) toDate = new Date(cycleEnd);

      const agentWorkingDays = countWeekdays(fromDate, toDate);

      // Walk through each weekday in the period
      const presentDates = [];
      const absentDates = [];
      const attMap = agentAttMap[aId] || {};

      const cur = new Date(fromDate);
      cur.setHours(12, 0, 0, 0);
      const endD = new Date(toDate);
      endD.setHours(12, 0, 0, 0);

      while (cur <= endD) {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) {
          const ds = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
          }).format(cur);
          if (attMap[ds]) {
            const loginTime = new Date(attMap[ds]);
            const threshold = new Date(`${ds}T09:31:00+05:30`);
            presentDates.push({
              date: ds,
              loginTime: attMap[ds],
              status: loginTime < threshold ? "Ontime" : "Late",
            });
          } else {
            absentDates.push(ds);
          }
        }
        cur.setDate(cur.getDate() + 1);
      }

      const presentDays = presentDates.length;
      const absentDays = absentDates.length;
      const forgivenAbsent = Math.min(1, absentDays);
      const effectiveAbsent = Math.max(0, absentDays - forgivenAbsent);
      const payableDays = presentDays + forgivenAbsent;
      const totalGeneratedDays = agentGenDays[aId] || 0;
      const availableDays = Math.max(0, payableDays - totalGeneratedDays);

      const existingInvoice = existingInvoices.find(
        (i) =>
          i.employeeId.toString() === aId &&
          i.campaign_id?.toString() === campaign._id.toString()
      );

      agents.push({
        agentId: aId,
        employeeName: agent.employeeName,
        employeeCode: agent.employeeCode,
        ctc: agent.ctc || 0,
        campaign: {
          _id: campaign._id,
          name: campaign.name,
          jcNumber: campaign.jcNumber,
        },
        assignedFrom: fromDate.toISOString().slice(0, 10),
        assignedTo: toDate.toISOString().slice(0, 10),
        agentWorkingDays,
        presentDays,
        absentDays,
        forgivenAbsent,
        effectiveAbsent,
        payableDays,
        totalGeneratedDays,
        availableDays,
        presentDates,
        absentDates,
        existingInvoice: existingInvoice
          ? {
              _id: existingInvoice._id,
              payableDays: existingInvoice.payableDays,
              salary: existingInvoice.salary,
              noOfDaysWorked: existingInvoice.noOfDaysWorked,
              noOfDaysPresent: existingInvoice.noOfDaysPresent,
              noOfDaysAbsent: existingInvoice.noOfDaysAbsent,
              incentive: existingInvoice.incentive,
              arrears: existingInvoice.arrears,
              extraPay: existingInvoice.extraPay,
              ctc: existingInvoice.ctc,
              endDate: existingInvoice.endDate,
              invoiceGenerated: existingInvoice.invoiceGenerated,
            }
          : null,
      });
    }

    return sendResponse(res, 200, "Salary dashboard fetched successfully", {
      cycleStart: cycleStartStr,
      cycleEnd: cycleEndStr,
      totalWorkingDays,
      totalCalendarDays,
      month,
      agents,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const downloadInvoicesZip = asyncHandler(async (req, res, next) => {
  try {
    const { invoiceIds } = req.body;
    if (!Array.isArray(invoiceIds) || !invoiceIds.length) {
      return sendError(next, "invoiceIds array is required", 400);
    }

    const invoices = await Invoice.find({ _id: { $in: invoiceIds } })
      .populate("employeeId", "employeeName employeeCode")
      .populate("campaign_id", "name")
      .lean();

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    await Promise.all(
      invoices.map(async (inv) => {
        const url = inv.invoiceGenerated?.invoiceUrl;
        if (!url) return;
        try {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          const name = `${(inv.employeeId?.employeeName || "Agent").replace(
            /\s+/g,
            "_"
          )}_${(inv.campaign_id?.name || "Campaign").replace(/\s+/g, "_")}.pdf`;
          zip.file(name, response.data);
        } catch (e) {
          console.error("Failed to fetch PDF:", url, e.message);
        }
      })
    );

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="Invoices.zip"`);
    res.send(buffer);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getAllInvoices,
  getAllInvoicesData,
  getInvoicesByPMId,
  generateAllInvoices,
  getAgentInvoicesDataByMonth,
  runInvoiceGeneration,
  updateAndGenerateInvoice,
  getAgentsByProgramManager,
  getInvoicesByPMAndMonth,
  getInvoicesOfAgent,
  getAllInvoicesOfPmMonthWise,
  getSalaryDashboard,
  downloadInvoicesZip,
};
