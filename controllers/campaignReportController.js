import utils from "../utils/index.js";
import CallingData from "../models/callingDataModal.js";
import Campaign from "../models/campaignModel.js";
import CampaignReport from "../models/campaignReportModel.js";

const { asyncHandler, sendResponse, sendError } = utils;

const SELECT_FIELDS = "Full_Name Job_Title Company_Name Company_Segment lastRemarks isRegistered lastCallingDate";

const buildDateRange = (dateFrom, dateTo, timeFrom, timeTo) => {
  const from = new Date(dateFrom);
  const to   = new Date(dateTo);
  if (timeFrom) { const [hh, mm] = timeFrom.split(":"); from.setHours(+hh, +mm, 0, 0); }
  else from.setHours(0, 0, 0, 0);
  if (timeTo)   { const [hh, mm] = timeTo.split(":");   to.setHours(+hh, +mm, 59, 999); }
  else to.setHours(23, 59, 59, 999);
  return { from, to };
};

const buildBaseQuery = (campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo) => {
  const query = { CampaignId: campaignId };
  if (reportType === "called") {
    const { from, to } = buildDateRange(dateFrom, dateTo, timeFrom, timeTo);
    query.lastCallingDate = { $gte: from, $lte: to };
  }
  return query;
};

// Fast aggregation — returns chart totals without fetching any rows
const fetchSummary = async (campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo) => {
  const base = buildBaseQuery(campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo);
  const [segments, regCounts, calledCounts, total] = await Promise.all([
    CallingData.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ["$Company_Segment", "Unknown"] }, count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
    ]),
    CallingData.aggregate([
      { $match: base },
      { $group: { _id: { $cond: [{ $eq: ["$isRegistered", true] }, "yes", "no"] }, count: { $sum: 1 } } },
    ]),
    CallingData.aggregate([
      { $match: base },
      { $group: { _id: { $cond: [{ $gt: ["$lastCallingDate", null] }, "yes", "no"] }, count: { $sum: 1 } } },
    ]),
    CallingData.countDocuments(base),
  ]);
  return {
    total,
    segments:   segments.map((s) => ({ label: s._id, count: s.count })),
    registered: {
      yes: regCounts.find((r) => r._id === "yes")?.count || 0,
      no:  regCounts.find((r) => r._id === "no")?.count  || 0,
    },
    called: {
      yes: calledCounts.find((c) => c._id === "yes")?.count || 0,
      no:  calledCounts.find((c) => c._id === "no")?.count  || 0,
    },
  };
};

// Paginated + optionally filtered rows for the table
const fetchPage = async (campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo, page, pageSize, filters = {}) => {
  const query = buildBaseQuery(campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo);

  if (filters.segment)                         query.Company_Segment = filters.segment;
  if (filters.registered === "Registered")     query.isRegistered = true;
  if (filters.registered === "Not Registered") query.isRegistered = false;
  if (filters.called === "Called")             query.lastCallingDate = { ...(query.lastCallingDate || {}), $ne: null };
  if (filters.called === "Not Called")         query.lastCallingDate = null;

  const skip = (page - 1) * pageSize;
  const [records, total] = await Promise.all([
    CallingData.find(query).select(SELECT_FIELDS).skip(skip).limit(pageSize).lean(),
    CallingData.countDocuments(query),
  ]);

  return {
    data: records.map((r) => ({
      _id:             String(r._id),
      Full_Name:       r.Full_Name       || "",
      Job_Title:       r.Job_Title       || "",
      Company_Name:    r.Company_Name    || "",
      Company_Segment: r.Company_Segment || "",
      lastRemarks:     r.lastRemarks     || "Yet to Call",
      isRegistered:    Boolean(r.isRegistered),
      lastCallingDate: r.lastCallingDate ? r.lastCallingDate.toISOString() : null,
    })),
    total,
    page,
    pageSize,
  };
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/campaignReport/generate
 * Saves report filter params to DB, fetches and returns live data.
 */
const generateReport = asyncHandler(async (req, res, next) => {
  const { campaignId, dateFrom, dateTo, timeFrom, timeTo, reportType, expiresAt } = req.body;

  if (!campaignId)          return sendError(next, "campaignId is required", 400);
  if (!dateFrom || !dateTo) return sendError(next, "dateFrom and dateTo are required", 400);
  if (!["called", "overall"].includes(reportType))
    return sendError(next, "reportType must be 'called' or 'overall'", 400);
  if (!expiresAt) return sendError(next, "expiresAt (share link expiry) is required", 400);

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime()) || expiry <= new Date())
    return sendError(next, "expiresAt must be a valid future date", 400);

  const campaign = await Campaign.findById(campaignId).select("name").lean();
  if (!campaign) return sendError(next, "Campaign not found", 404);

  const [summary, pageResult, report] = await Promise.all([
    fetchSummary(campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo),
    fetchPage(campaignId, reportType, dateFrom, dateTo, timeFrom, timeTo, 1, 20),
    CampaignReport.create({
      campaignId,
      campaignName: campaign.name,
      pmId:     req.user._id,
      pmName:   req.user.employeeName,
      dateFrom: new Date(dateFrom),
      dateTo:   new Date(dateTo),
      timeFrom: timeFrom || "",
      timeTo:   timeTo   || "",
      reportType,
      expiresAt: expiry,
    }),
  ]);

  return sendResponse(res, 200, "Report generated successfully", {
    report:   report.toObject(),
    summary,
    data:     pageResult.data,
    total:    pageResult.total,
    page:     pageResult.page,
    pageSize: pageResult.pageSize,
  });
});

/**
 * GET /api/campaignReport/history
 * Returns ALL saved reports for the logged-in PM — no data payloads.
 */
const getAllReportHistory = asyncHandler(async (req, res) => {
  const reports = await CampaignReport.find({ pmId: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  return sendResponse(res, 200, "Report history fetched", reports);
});

/**
 * GET /api/campaignReport/history/:campaignId
 * Returns saved report params for a specific campaign — no data payloads.
 */
const getReportHistory = asyncHandler(async (req, res, next) => {
  const { campaignId } = req.params;
  if (!campaignId) return sendError(next, "campaignId is required", 400);

  const reports = await CampaignReport.find({ campaignId })
    .sort({ createdAt: -1 })
    .lean();

  return sendResponse(res, 200, "Report history fetched", reports);
});

/**
 * GET /api/campaignReport/:reportId
 * Load a specific saved report — re-queries CallingData using stored params.
 */
const getReportById = asyncHandler(async (req, res, next) => {
  const report = await CampaignReport.findById(req.params.reportId).lean();
  if (!report) return sendError(next, "Report not found", 404);

  const { page = 1, pageSize = 20, segment, registered, called } = req.query;
  const filters = {};
  if (segment)    filters.segment    = segment;
  if (registered) filters.registered = registered;
  if (called)     filters.called     = called;

  const [summary, pageResult] = await Promise.all([
    fetchSummary(report.campaignId, report.reportType, report.dateFrom, report.dateTo, report.timeFrom, report.timeTo),
    fetchPage(report.campaignId, report.reportType, report.dateFrom, report.dateTo, report.timeFrom, report.timeTo, +page, +pageSize, filters),
  ]);

  return sendResponse(res, 200, "Report loaded", {
    report,
    summary,
    data:     pageResult.data,
    total:    pageResult.total,
    page:     pageResult.page,
    pageSize: pageResult.pageSize,
  });
});

/**
 * GET /api/campaignReport/shared/:token  — PUBLIC, no auth
 */
const getSharedReport = asyncHandler(async (req, res, next) => {
  const report = await CampaignReport.findOne({ shareToken: req.params.token }).lean();
  if (!report) return sendError(next, "Report not found", 404);

  if (new Date() > new Date(report.expiresAt)) {
    return res.status(410).json({ status: "expired", message: "This report link has expired.", expiresAt: report.expiresAt });
  }

  const { page = 1, pageSize = 20, segment, registered, called } = req.query;
  const filters = {};
  if (segment)    filters.segment    = segment;
  if (registered) filters.registered = registered;
  if (called)     filters.called     = called;

  const [summary, pageResult] = await Promise.all([
    fetchSummary(report.campaignId, report.reportType, report.dateFrom, report.dateTo, report.timeFrom, report.timeTo),
    fetchPage(report.campaignId, report.reportType, report.dateFrom, report.dateTo, report.timeFrom, report.timeTo, +page, +pageSize, filters),
  ]);

  return sendResponse(res, 200, "Report fetched", {
    report,
    summary,
    data:     pageResult.data,
    total:    pageResult.total,
    page:     pageResult.page,
    pageSize: pageResult.pageSize,
  });
});

export { generateReport, getAllReportHistory, getReportHistory, getReportById, getSharedReport };
