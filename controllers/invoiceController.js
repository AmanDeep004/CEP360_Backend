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

  const presentDays    = presentDates.length;
  const absentDays     = absentDates.length;          // weekday absences
  const forgivenAbsent = Math.min(1, absentDays);     // 1 free leave
  const effectiveAbsent = Math.max(0, absentDays - forgivenAbsent);
  const payableDays    = totalWorkingDays - effectiveAbsent;

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

const insertSignatureFromUrl = (url, doc) => {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response
        .on("data", (chunk) => chunks.push(chunk))
        .on("end", () => {
          const buffer = Buffer.concat(chunks);
          try {
            doc.image(buffer, 40, 430, { width: 120, height: 60 });
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
      return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
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
      return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
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
        return sendError(next, "No invoices found for this Program Manager", 404);
      }
      return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
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

    console.log(`[INFO] Found ${assignments.length} active assignments across ${campaigns.length} active campaigns`);

    // Use fixed month names to avoid locale differences between server and client
    const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const month = `${MONTH_NAMES[endDateRef.getMonth()]} ${endDateRef.getFullYear()}`;
    const monthWorkingDays = countWeekdays(startDateRef, endDateRef);

    console.log(`[INFO] Month label: "${month}", Cycle working days: ${monthWorkingDays}`);

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

      const { presentDays, absentDays, totalWorkingDays, forgivenAbsent, effectiveAbsent, payableDays, totalCalendarDays } = attendanceSummary;
      const agentCtc = agent.ctc || 0;
      const salary = monthWorkingDays > 0
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

    console.log(`[INFO] Inserted: ${insertedCount}, Skipped (already exist): ${skippedCount}`);

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

      const { presentDays, absentDays, totalWorkingDays, forgivenAbsent, effectiveAbsent, payableDays, totalCalendarDays } = attendanceSummary;
      const agentCtc = agent.ctc || 0;
      const monthWorkingDays = countWeekdays(startDateRef, endDateRef);
      const salary = monthWorkingDays > 0
        ? Math.round((agentCtc / monthWorkingDays) * payableDays)
        : 0;

      // Use END date of cycle as month label — fixed format to avoid locale differences
      const _MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      const month = `${_MONTHS[endDateRef.getMonth()]} ${endDateRef.getFullYear()}`;

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
      ctc,
      incentive,
      arrears,
      extraPay,
      noOfDaysWorked,   // days present (PM can edit)
      noOfDaysAbsent,   // days absent (derived, sent for storage)
      monthWorkingDays: payloadMonthWorkingDays, // full cycle Mon-Fri (PM can override)
      startDate,
      endDate,
      genBy,
      salaryModBy,
    } = req.body;

    if (!invoiceId || !startDate || !endDate || !ctc || !genBy) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.findById(invoiceId).populate("employeeId");
    if (!invoice) return sendError(next, "Invoice not found", 404);

    const employee = invoice.employeeId;
    if (!employee) return sendError(next, "Employee not found", 404);

    // monthWorkingDays used for everything — rate divisor AND absent calc
    const monthWorkingDays = Number(payloadMonthWorkingDays) || Number(invoice.monthWorkingDays) || (Number(noOfDaysWorked) + Number(noOfDaysAbsent));
    const present          = Math.min(Number(noOfDaysWorked) || 0, monthWorkingDays);
    const absent           = Math.max(0, monthWorkingDays - present);
    const forgivenAbsent   = Math.min(1, absent);
    const effectiveAbsent  = Math.max(0, absent - forgivenAbsent);
    const payableDays      = present + forgivenAbsent;
    const dailyRate        = monthWorkingDays > 0 ? Number(ctc) / monthWorkingDays : 0;
    const gross            = Math.round(dailyRate * payableDays);
    const finalCTC         = gross + Number(incentive) + Number(arrears) + Number(extraPay);

    // Update invoice fields
    invoice.ctc                     = Number(ctc);
    invoice.noOfDaysWorked          = present;
    invoice.noOfDaysAbsent          = absent;
    invoice.monthWorkingDays        = monthWorkingDays;
    invoice.forgivenAbsent          = forgivenAbsent;
    invoice.effectiveAbsent         = effectiveAbsent;
    invoice.payableDays             = payableDays;
    invoice.incentive               = incentive;
    invoice.arrears                 = arrears;
    invoice.extraPay                = extraPay;
    invoice.startDate               = new Date(startDate);
    invoice.endDate                 = new Date(endDate);
    invoice.salaryModBy             = salaryModBy;
    invoice.daysAvailabletoGenerate = 0;
    invoice.invoiceGenerated.genBy  = genBy;
    invoice.salary                  = gross;

    // Generate PDF in memory
    const pdfFilename = `invoice-${invoice._id}-${Date.now()}.pdf`;
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    // Store PDF data in memory
    const pdfBuffers = [];
    doc.on("data", (chunk) => {
      pdfBuffers.push(chunk);
    });

    // Draw outer border
    doc.rect(20, 20, 555, 800).stroke("#333");

    // HEADER
    doc.rect(20, 20, 555, 30).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("INVOICE", 20, 28, { align: "center", width: 555 });
    doc.fillColor("#000");

    // --- TOP INFO BLOCKS ---
    doc.lineWidth(1).strokeColor("#333");

    // Left block
    doc.rect(20, 50, 277.5, 110).stroke();
    doc.font("Helvetica-Bold").fontSize(10).text("From :", 30, 60);
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(employee.employeeName || "N/A", 80, 60);
    doc.font("Helvetica-Bold").text("Employee Code:", 30, 80);
    doc.font("Helvetica").text(employee.employeeCode || "N/A", 120, 80);
    doc.font("Helvetica-Bold").text("Address:", 30, 100);
    doc
      .font("Helvetica")
      .text(employee.location || "N/A", 80, 100, { width: 200 });

    // Right block
    doc.rect(297.5, 50, 277.5, 110).stroke();
    doc.font("Helvetica-Bold").text("Contact Number:", 307.5, 60);
    doc.font("Helvetica").text(employee.mobile || "N/A", 410, 60);
    doc.font("Helvetica-Bold").text("Mobile Number:", 307.5, 75);
    doc.font("Helvetica").text(employee.mobile || "N/A", 410, 75);
    doc.font("Helvetica-Bold").text("Permanent Account Number:", 307.5, 90);
    doc.font("Helvetica").text(employee.pan || "N/A", 470, 90);
    doc.font("Helvetica-Bold").text("GSTIN Number:", 307.5, 105);
    doc.font("Helvetica").text(employee.gstin || "N/A", 410, 105);

    // --- TO & INVOICE INFO BLOCKS ---
    doc.rect(20, 160, 277.5, 80).stroke();
    doc.font("Helvetica-Bold").text("TO", 30, 170);
    doc
      .font("Helvetica")
      .text("Kestone IMS – A Division of CL Educate Limited", 60, 170, {
        width: 220,
      });
    doc
      .font("Helvetica")
      .text(
        "#37, 7th Cross, RMJ Mandoth Towers, 3rd Floor, Vasanth Nagar, Bangalore-5600052",
        30,
        190,
        { width: 260 }
      );

    doc.rect(297.5, 160, 277.5, 80).stroke();
    doc.font("Helvetica-Bold").text("Invoice No :", 307.5, 170);
    doc.font("Helvetica").text(invoice._id, 370, 170);
    doc.font("Helvetica-Bold").text("FY :", 307.5, 185);
    doc
      .font("Helvetica")
      .text(
        new Date(startDate).getFullYear() +
          "-" +
          (new Date(startDate).getFullYear() + 1) +
          "/" +
          new Date(startDate).toLocaleString("default", { month: "long" }),
        340,
        185
      );
    doc.font("Helvetica-Bold").text("Date :", 307.5, 200);
    doc
      .font("Helvetica")
      .text(new Date(endDate).toLocaleDateString("en-GB"), 350, 200);
    doc.font("Helvetica-Bold").text("GSTIN No :", 307.5, 215);
    doc.font("Helvetica").text("29AACCB3885C2ZO", 370, 215);

    // --- PARTICULARS & AMOUNT TABLE HEADER ---
    doc.rect(20, 240, 370, 30).fillAndStroke("#666", "#333");
    doc.rect(390, 240, 185, 30).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("PARTICULARS", 25, 250, { width: 360 })
      .text("AMOUNT (Rs)", 395, 250, { width: 175, align: "right" });
    doc.fillColor("#000");

    // --- PARTICULARS & AMOUNT TABLE BODY ---
    doc.rect(20, 270, 370, 80).stroke();
    doc.rect(390, 270, 185, 80).stroke();
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(
        "Professional Charges for the M/O " +
          new Date(startDate).toLocaleString("default", { month: "long" }) +
          "' " +
          new Date(startDate).getFullYear() +
          " for rendering services as per below detail",
        25,
        275,
        { width: 360, height: 100 }
      );
    doc.text(`Gross Fees: INR. ${gross}/-`, 25, 295);
    doc.text(`Incentive or other payment: ${incentive}`, 25, 310);
    doc.text(`Extra Pay: ${extraPay}`, 25, 325);
    doc.text(`Arrears: ${arrears}`, 25, 340);
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(`INR. ${finalCTC}/-`, 395, 310, { width: 175, align: "right" });

    // --- TOTAL AMOUNT PAYABLE ---
    doc.rect(20, 350, 370, 30).fillAndStroke("#666", "#333");
    doc.rect(390, 350, 185, 30).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("TOTAL AMOUNT PAYABLE", 25, 360, { width: 360 })
      .text(`INR. ${finalCTC}/-`, 395, 360, { width: 175, align: "right" });
    doc.fillColor("#000");

    // --- AMOUNT IN WORDS ---
    doc.rect(20, 380, 555, 30).fillAndStroke("#666", "#333");
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`AMOUNT IN WORDS : ${finalCTC} ONLY`, 25, 390, { width: 545 });
    doc.fillColor("#000");

    // --- SIGNATURE & NAME BLOCK ---
    doc.rect(20, 410, 277.5, 100).stroke();
    doc.rect(297.5, 410, 277.5, 100).stroke();

    // Signature image (if available)
    try {
      const signaturePath = await insertSignatureFromUrl(
        employee?.signature,
        doc
      );
      if (signaturePath && fs.existsSync(signaturePath)) {
        doc.image(signaturePath, 40, 430, { width: 120, height: 60 });
      }
    } catch (signatureError) {
      console.error("Signature insertion failed:", signatureError);
      // Continue without signature
    }

    // Name and signature info
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("NAME - Ishant Hingorani", 310, 430);
    doc
      .font("Helvetica-Bold")
      .text(
        "DATE - " + new Date(endDate).toLocaleDateString("en-GB"),
        310,
        450
      );
    doc.font("Helvetica-Bold").text("SIGNATURE - Ishant Hingorani", 310, 470);

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
      return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
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
      return sendResponse(res, 200, "Invoices retrieved successfully", invoices);
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
};
