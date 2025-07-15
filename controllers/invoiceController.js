import Invoice from "../models/invoiceModel.js";
import User from "../models/userModel.js";
import Campaign from "../models/campaignModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import errorHandler from "../utils/index.js";
import PDFDocument from "pdfkit";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const updateAndGenerateInvoiceOld = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      ctc,
      incentive = 0,
      arrears = 0,
      extraPay = 0,
      noOfDaysWorked,
      noOfDaysAbsent = 0,
      startDate,
      endDate,
      salaryModBy,
    } = req.body;

    if (!invoiceId || !noOfDaysWorked || !startDate || !endDate) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return sendError(next, "Invoice not found", 404);

    // Calculate gross salary from CTC
    const gross = Math.round((ctc / 30) * Number(noOfDaysWorked));

    // Final salary calculation
    const finalCTC =
      gross + Number(incentive) + Number(arrears) + Number(extraPay);

    const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
    const daysAvailabletoGenerate = 30 - Number(noOfDaysWorked);

    // Update invoice
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

    return sendResponse(
      res,
      200,
      "Invoice updated and generated successfully",
      {
        finalCTC,
        invoice,
      }
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const updateAndGenerateInvoice1 = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      ctc = 20000,
      incentive = 0,
      arrears = 0,
      extraPay = 0,
      noOfDaysWorked,
      noOfDaysAbsent = 0,
      startDate,
      endDate,
      salaryModBy,
    } = req.body;

    if (!invoiceId || !noOfDaysWorked || !startDate || !endDate || !ctc) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.findById(invoiceId).populate("employeeId");
    if (!invoice) return sendError(next, "Invoice not found", 404);

    const employee = invoice.employeeId;
    if (!employee) return sendError(next, "Employee not found", 404);

    // Salary Calculations
    const gross = Math.round((ctc / 30) * Number(noOfDaysWorked));
    const finalCTC =
      gross + Number(incentive) + Number(arrears) + Number(extraPay);
    const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
    const daysAvailabletoGenerate = 30 - Number(noOfDaysWorked);

    // Update Invoice
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

    // Create PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=invoice-${invoice._id}.pdf`
      );
      res.send(pdfData);
    });

    // Invoice Content
    doc.fontSize(16).text("INVOICE", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`From: ${employee.employeeName || "N/A"}`);
    doc.text(`Employee Code: ${employee.employeeCode || "N/A"}`);
    doc.text(`Mobile: ${employee.mobile || "N/A"}`);
    doc.text(`PAN: ${employee.pan || "N/A"}`);
    doc.moveDown();

    doc.text(`Invoice Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Invoice ID: ${invoice._id}`);
    doc.text(
      `Month: ${new Date(startDate).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })}`
    );
    doc.moveDown();

    doc.fontSize(13).text("PARTICULARS", { underline: true });
    doc.text(`Gross Salary: ₹${gross}`);
    doc.text(`Incentive: ₹${incentive}`);
    doc.text(`Arrears: ₹${arrears}`);
    doc.text(`Extra Pay: ₹${extraPay}`);
    doc.moveDown();

    doc.fontSize(13).text(`Total Salary: ₹${finalCTC}`, { bold: true });
    doc.moveDown();

    doc.text(`No. of Days Worked: ${noOfDaysWorked}`);
    doc.text(`No. of Days Absent: ${noOfDaysAbsent}`);
    doc.text(`Total Days Generated: ${totalDaysGenerated}`);
    doc.text(`Days Available to Generate: ${daysAvailabletoGenerate}`);
    doc.text(`CTC: ₹${ctc}`);
    doc.text(`Modified By: ${salaryModBy || "N/A"}`);
    doc.moveDown();

    // Signature
    doc.text("Signature:");
    if (employee.signature) {
      try {
        const response = await axios.get(employee.signature, {
          responseType: "arraybuffer",
        });
        const signatureBuffer = Buffer.from(response.data, "binary");
        doc.image(signatureBuffer, {
          width: 100,
          align: "left",
        });
      } catch (err) {
        doc.text("Signature could not be loaded from CDN.");
      }
    } else {
      doc.text("Not Available");
    }

    doc.end(); // Finalize and send PDF
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

// const updateAndGenerateInvoice = asyncHandler(async (req, res, next) => {
//   try {
//     const {
//       invoiceId,
//       ctc = 20000,
//       incentive = 0,
//       arrears = 0,
//       extraPay = 0,
//       noOfDaysWorked,
//       noOfDaysAbsent = 0,
//       startDate,
//       endDate,
//       salaryModBy,
//     } = req.body;

//     if (!invoiceId || !noOfDaysWorked || !startDate || !endDate || !ctc) {
//       return sendError(next, "Missing required fields", 400);
//     }

//     const invoice = await Invoice.findById(invoiceId).populate("employeeId");
//     if (!invoice) return sendError(next, "Invoice not found", 404);

//     const employee = invoice.employeeId;
//     if (!employee) return sendError(next, "Employee not found", 404);

//     // Salary Calculations
//     const gross = Math.round((ctc / 30) * Number(noOfDaysWorked));
//     const finalCTC =
//       gross + Number(incentive) + Number(arrears) + Number(extraPay);
//     const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
//     const daysAvailabletoGenerate = 30 - Number(noOfDaysWorked);

//     // Update Invoice generatun
//     invoice.incentive = incentive;
//     invoice.arrears = arrears;
//     invoice.extraPay = extraPay;
//     invoice.noOfDaysWorked = noOfDaysWorked;
//     invoice.noOfDaysAbsent = noOfDaysAbsent;
//     invoice.startDate = new Date(startDate);
//     invoice.endDate = new Date(endDate);
//     invoice.salaryModBy = salaryModBy;
//     invoice.totalDaysGenerated = totalDaysGenerated;
//     invoice.daysAvailabletoGenerate = daysAvailabletoGenerate;
//     invoice.ctc = finalCTC;

//     // Generate PDF filename and save to invoice
//     const pdfFilename = `invoice-${invoice._id}-${Date.now()}.pdf`;
//     const pdfUrl = `/uploads/invoices/${pdfFilename}`;
//     invoice.invoiceGenerated.invoiceUrl = pdfUrl;
//     invoice.invoiceGenerated.status = true;

//     await invoice.save();

//     // Create PDF with professional styling
//     const doc = new PDFDocument({ size: "A4", margin: 40 });
//     const buffers = [];

//     doc.on("data", buffers.push.bind(buffers));
//     doc.on("end", () => {
//       const pdfData = Buffer.concat(buffers);
//       res.setHeader("Content-Type", "application/pdf");
//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename=${pdfFilename}`
//       );
//       res.send(pdfData);
//     });

//     // Helper function to draw bordered boxes
//     const drawBox = (x, y, width, height, fillColor = null) => {
//       if (fillColor) {
//         doc.rect(x, y, width, height).fillAndStroke(fillColor, "#000000");
//       } else {
//         doc.rect(x, y, width, height).stroke("#000000");
//       }
//     };

//     // Page dimensions
//     const pageWidth = doc.page.width - 80; // 40 margin on each side
//     const startY = 60;
//     let currentY = startY;

//     // Header with gray background
//     drawBox(40, currentY, pageWidth, 35, "#E8E8E8");
//     doc
//       .fillColor("#000000")
//       .fontSize(16)
//       .font("Helvetica-Bold")
//       .text("INVOICE", 40, currentY + 12, {
//         width: pageWidth,
//         align: "center",
//       });

//     currentY += 50;

//     // Company and Contact Info Section
//     const leftColumnWidth = pageWidth * 0.6;
//     const rightColumnWidth = pageWidth * 0.4;
//     const sectionHeight = 120;

//     // Left column - From details
//     drawBox(40, currentY, leftColumnWidth, sectionHeight);
//     doc
//       .fillColor("#000000")
//       .fontSize(10)
//       .font("Helvetica-Bold")
//       .text("From:", 50, currentY + 10);

//     doc
//       .font("Helvetica")
//       .text(`${employee.employeeName || "N/A"}`, 50, currentY + 25)
//       .text(
//         `Employee Code: ${employee.employeeCode || "N/A"}`,
//         50,
//         currentY + 40
//       )
//       .text(`Address: ${employee.address || "N/A"}`, 50, currentY + 55)
//       .text(`Mobile: ${employee.mobile || "N/A"}`, 50, currentY + 70)
//       .text(`PAN: ${employee.pan || "N/A"}`, 50, currentY + 85);

//     // Right column - Invoice details
//     drawBox(40 + leftColumnWidth, currentY, rightColumnWidth, sectionHeight);
//     doc
//       .font("Helvetica-Bold")
//       .text("Contact Number:", 50 + leftColumnWidth, currentY + 10);

//     doc
//       .font("Helvetica")
//       .text(`${employee.mobile || "N/A"}`, 50 + leftColumnWidth, currentY + 25)
//       .text(
//         `Invoice Number: ${invoice._id.toString().slice(-8)}`,
//         50 + leftColumnWidth,
//         currentY + 45
//       )
//       .text(
//         `Date: ${new Date().toLocaleDateString()}`,
//         50 + leftColumnWidth,
//         currentY + 60
//       )
//       .text(
//         `Month: ${new Date(startDate).toLocaleString("default", {
//           month: "long",
//           year: "numeric",
//         })}`,
//         50 + leftColumnWidth,
//         currentY + 75
//       );

//     currentY += sectionHeight + 20;

//     // Bill To Section
//     const billToHeight = 80;
//     drawBox(40, currentY, pageWidth, billToHeight);
//     doc.font("Helvetica-Bold").text("Bill To:", 50, currentY + 10);

//     doc
//       .font("Helvetica")
//       .text("Company Name - HR Department", 50, currentY + 25)
//       .text("Company Address", 50, currentY + 40)
//       .text("City, State, PIN Code", 50, currentY + 55);

//     currentY += billToHeight + 20;

//     // Particulars Header
//     const headerHeight = 25;
//     drawBox(40, currentY, pageWidth * 0.7, headerHeight, "#E8E8E8");
//     drawBox(
//       40 + pageWidth * 0.7,
//       currentY,
//       pageWidth * 0.3,
//       headerHeight,
//       "#E8E8E8"
//     );

//     doc
//       .fillColor("#000000")
//       .font("Helvetica-Bold")
//       .text("PARTICULARS", 50, currentY + 8);

//     doc.text("AMOUNT (INR)", 50 + pageWidth * 0.7, currentY + 8, {
//       width: pageWidth * 0.3 - 20,
//       align: "center",
//     });

//     currentY += headerHeight;

//     // Salary Details Rows
//     const rowHeight = 25;
//     const salaryItems = [
//       {
//         label:
//           "Professional Charges for the CTC given and for rendering services as per terms stated",
//         amount: gross,
//       },
//       { label: "Gross Fees: INR", amount: gross },
//       { label: "Incentive:", amount: incentive },
//       { label: "Arrears:", amount: arrears },
//       { label: "Extra Pay:", amount: extraPay },
//     ];

//     salaryItems.forEach((item, index) => {
//       drawBox(40, currentY, pageWidth * 0.7, rowHeight);
//       drawBox(40 + pageWidth * 0.7, currentY, pageWidth * 0.3, rowHeight);

//       doc
//         .font("Helvetica")
//         .text(item.label, 50, currentY + 8, { width: pageWidth * 0.7 - 20 });

//       if (index === 0) {
//         doc.text("", 50 + pageWidth * 0.7, currentY + 8, {
//           width: pageWidth * 0.3 - 20,
//           align: "center",
//         });
//       } else {
//         doc.text(`₹${item.amount}`, 50 + pageWidth * 0.7, currentY + 8, {
//           width: pageWidth * 0.3 - 20,
//           align: "center",
//         });
//       }

//       currentY += rowHeight;
//     });

//     // Total Amount
//     const totalHeight = 40;
//     drawBox(40, currentY, pageWidth * 0.7, totalHeight, "#E8E8E8");
//     drawBox(
//       40 + pageWidth * 0.7,
//       currentY,
//       pageWidth * 0.3,
//       totalHeight,
//       "#E8E8E8"
//     );

//     doc.font("Helvetica-Bold").text("TOTAL AMOUNT PAYABLE:", 50, currentY + 12);

//     doc
//       .fontSize(14)
//       .text(`INR. ${finalCTC}/-`, 50 + pageWidth * 0.7, currentY + 12, {
//         width: pageWidth * 0.3 - 20,
//         align: "center",
//       });

//     currentY += totalHeight + 20;

//     // Additional Details
//     doc
//       .fontSize(10)
//       .font("Helvetica")
//       .text(`No. of Days Worked: ${noOfDaysWorked}`, 50, currentY)
//       .text(`No. of Days Absent: ${noOfDaysAbsent}`, 50, currentY + 15)
//       .text(`Total Days Generated: ${totalDaysGenerated}`, 50, currentY + 30)
//       .text(
//         `Days Available to Generate: ${daysAvailabletoGenerate}`,
//         50,
//         currentY + 45
//       )
//       .text(`CTC: ₹${ctc}`, 50, currentY + 60)
//       .text(`Modified By: ${salaryModBy || "N/A"}`, 50, currentY + 75);

//     currentY += 100;

//     // Signature Section
//     const signatureHeight = 100;
//     drawBox(40, currentY, pageWidth * 0.5, signatureHeight);
//     drawBox(40 + pageWidth * 0.5, currentY, pageWidth * 0.5, signatureHeight);

//     doc.font("Helvetica-Bold").text("AUTHORISED SIGNATORY:", 50, currentY + 10);

//     doc
//       .font("Helvetica")
//       .text(
//         `NAME: ${employee.employeeName || "N/A"}`,
//         50 + pageWidth * 0.5,
//         currentY + 10
//       )
//       .text(
//         `DATE: ${new Date().toLocaleDateString()}`,
//         50 + pageWidth * 0.5,
//         currentY + 25
//       )
//       .text(
//         `SIGNATURE: ${employee.employeeName || "N/A"}`,
//         50 + pageWidth * 0.5,
//         currentY + 40
//       );

//     // Add signature if available
//     if (employee.signature) {
//       try {
//         const response = await axios.get(employee.signature, {
//           responseType: "arraybuffer",
//         });
//         const signatureBuffer = Buffer.from(response.data, "binary");
//         doc.image(signatureBuffer, 50, currentY + 30, {
//           width: 80,
//           height: 40,
//           fit: [80, 40],
//         });
//       } catch (err) {
//         doc.text("Signature could not be loaded", 50, currentY + 50);
//       }
//     }

//     doc.end();
//   } catch (error) {
//     return sendError(next, error.message, 500);
//   }
// });

//to get all agents to show it in dropdown

const updateAndGenerateInvoice3 = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      ctc = 20000,
      incentive = 0,
      arrears = 0,
      extraPay = 0,
      noOfDaysWorked,
      noOfDaysAbsent = 0,
      startDate,
      endDate,
      salaryModBy,
    } = req.body;

    if (!invoiceId || !noOfDaysWorked || !startDate || !endDate || !ctc) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.findById(invoiceId).populate("employeeId");
    if (!invoice) return sendError(next, "Invoice not found", 404);

    const employee = invoice.employeeId;
    if (!employee) return sendError(next, "Employee not found", 404);

    const gross = Math.round((ctc / 30) * Number(noOfDaysWorked));
    const finalCTC =
      gross + Number(incentive) + Number(arrears) + Number(extraPay);
    const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
    const daysAvailabletoGenerate = 30 - Number(noOfDaysWorked);

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

    const pdfFilename = `invoice-${invoice._id}-${Date.now()}.pdf`;
    const tempFolderPath = path.join(__dirname, "../temp");
    const outputPath = path.join(tempFolderPath, pdfFilename);

    if (!fs.existsSync(tempFolderPath)) fs.mkdirSync(tempFolderPath);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(fs.createWriteStream(outputPath));

    doc.fontSize(16).text("INVOICE", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Employee Name: ${employee.employeeName || "N/A"}`);
    doc.text(`Employee Code: ${employee.employeeCode || "N/A"}`);
    doc.text(`Invoice ID: ${invoice._id}`);
    doc.text(
      `Month: ${new Date(startDate).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })}`
    );
    doc.moveDown();
    doc.text(`Gross: ₹${gross}`);
    doc.text(`Incentive: ₹${incentive}`);
    doc.text(`Arrears: ₹${arrears}`);
    doc.text(`Extra Pay: ₹${extraPay}`);
    doc.text(`Total: ₹${finalCTC}`);
    doc.text(`Days Worked: ${noOfDaysWorked}`);
    doc.text(`Days Absent: ${noOfDaysAbsent}`);
    doc.text(`Modified By: ${salaryModBy || "N/A"}`);
    doc.end();
    console.log(doc, "amandeep");
    doc.on("end", async () => {
      try {
        const form = new FormData();
        form.append("file", fs.createReadStream(outputPath));
        form.append("type", "pdf");
        console.log(process.env.BASE_URL, "amandeep");
        const uploadResponse = await axios.post(
          `${process.env.BASE_URL}api/upload/upload`,
          form,
          { headers: form.getHeaders() }
        );

        const uploadedUrl = uploadResponse.data?.data?.url;
        if (!uploadedUrl) {
          return sendError(next, "Upload failed: No URL returned", 500);
        }

        invoice.invoiceGenerated.invoiceUrl = uploadedUrl;
        invoice.invoiceGenerated.status = true;
        await invoice.save();

        fs.unlinkSync(outputPath);

        return sendResponse(
          res,
          200,
          "Invoice updated, generated and uploaded",
          {
            invoice,
            finalCTC,
            uploadedUrl,
          }
        );
      } catch (uploadErr) {
        return sendError(next, `Upload failed: ${uploadErr.message}`, 500);
      }
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
const updateAndGenerateInvoice = asyncHandler(async (req, res, next) => {
  try {
    const {
      invoiceId,
      ctc = 20000,
      incentive = 0,
      arrears = 0,
      extraPay = 0,
      noOfDaysWorked,
      noOfDaysAbsent = 0,
      startDate,
      endDate,
      salaryModBy,
    } = req.body;

    if (!invoiceId || !noOfDaysWorked || !startDate || !endDate || !ctc) {
      return sendError(next, "Missing required fields", 400);
    }

    const invoice = await Invoice.findById(invoiceId).populate("employeeId");
    if (!invoice) return sendError(next, "Invoice not found", 404);

    const employee = invoice.employeeId;
    if (!employee) return sendError(next, "Employee not found", 404);

    // Salary Calculations
    const gross = Math.round((ctc / 30) * Number(noOfDaysWorked));
    const finalCTC =
      gross + Number(incentive) + Number(arrears) + Number(extraPay);
    const totalDaysGenerated = Number(noOfDaysWorked) + Number(noOfDaysAbsent);
    const daysAvailabletoGenerate = 30 - Number(noOfDaysWorked);

    // Update invoice fields
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

    // Generate PDF
    const pdfFilename = `invoice-${invoice._id}-${Date.now()}.pdf`;
    const tempFolderPath = path.resolve("temp"); // avoid __dirname
    const outputPath = path.join(tempFolderPath, pdfFilename);

    if (!fs.existsSync(tempFolderPath)) fs.mkdirSync(tempFolderPath);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    // --- PDF Content ---
    doc.fontSize(16).text("INVOICE", { align: "center" }).moveDown();
    doc.fontSize(12).text(`Employee Name: ${employee.employeeName || "N/A"}`);
    doc.text(`Employee Code: ${employee.employeeCode || "N/A"}`);
    doc.text(`Invoice ID: ${invoice._id}`);
    doc.text(
      `Month: ${new Date(startDate).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })}`
    );
    doc.moveDown();
    doc.text(`Gross: ₹${gross}`);
    doc.text(`Incentive: ₹${incentive}`);
    doc.text(`Arrears: ₹${arrears}`);
    doc.text(`Extra Pay: ₹${extraPay}`);
    doc.text(`Total: ₹${finalCTC}`);
    doc.text(`Days Worked: ${noOfDaysWorked}`);
    doc.text(`Days Absent: ${noOfDaysAbsent}`);
    doc.text(`Modified By: ${salaryModBy || "N/A"}`);
    doc.end();

    writeStream.on("finish", async () => {
      try {
        const form = new FormData();
        form.append("file", fs.createReadStream(outputPath));
        form.append("type", "pdf");

        const uploadResponse = await axios.post(
          `${process.env.BASE_URL}api/upload/upload`,
          form,
          { headers: form.getHeaders() }
        );
        console.log("Upload API response:", uploadResponse.data);

        const uploadedUrl = uploadResponse?.data?.data?.fileSrc;
        if (!uploadedUrl) {
          return sendError(next, "Upload failed: No URL returned", 500);
        }

        invoice.invoiceGenerated.invoiceUrl = uploadedUrl;
        invoice.invoiceGenerated.status = true;
        await invoice.save();

        fs.unlinkSync(outputPath);

        return sendResponse(
          res,
          200,
          "Invoice updated, generated and uploaded",
          {
            invoice,
            finalCTC,
            uploadedUrl,
          }
        );
      } catch (uploadErr) {
        return sendError(next, `Upload failed: ${uploadErr.message}`, 500);
      }
    });

    writeStream.on("error", (err) => {
      return sendError(next, `PDF write failed: ${err.message}`, 500);
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
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
