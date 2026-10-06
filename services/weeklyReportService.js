/**
 * weeklyReportService.js
 * Weekly management summary email — every Monday 9:00 AM IST.
 * Previous full week: Monday 00:00 IST → Sunday 23:59 IST.
 * HTML is fully responsive — works on phone, tablet, laptop, all email clients.
 */

import { sendEmail } from "./microsoftGraphMailer.js";

const PORTAL_URL  = "https://cep360.kestoneapps.in/";
const REG_REMARKS = ["Registered", "Already Registered"];
const IST_OFFSET  = 5.5 * 60 * 60 * 1000;

// ── Date helpers ──────────────────────────────────────────────────────────────

function previousWeekRangeIST() {
  const now    = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET);
  const dow    = istNow.getUTCDay(); // 0=Sun … 6=Sat
  const daysToCurrentMon = dow === 0 ? 6 : dow - 1;

  const prevMon = new Date(istNow);
  prevMon.setUTCDate(istNow.getUTCDate() - daysToCurrentMon - 7);
  prevMon.setUTCHours(0, 0, 0, 0);

  const prevSun = new Date(istNow);
  prevSun.setUTCDate(istNow.getUTCDate() - daysToCurrentMon - 1);
  prevSun.setUTCHours(23, 59, 59, 999);

  return {
    start: new Date(prevMon.getTime() - IST_OFFSET),
    end:   new Date(prevSun.getTime() - IST_OFFSET),
  };
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}
function fmt(n)    { return (n ?? 0).toLocaleString("en-IN"); }
function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "—"; }

// ── Responsive HTML primitives (table-based, email-client safe) ───────────────

function badge(status) {
  const bg = { active: "#16a34a", completed: "#2563eb", inactive: "#9ca3af" }[status] || "#9ca3af";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${bg};color:#fff;white-space:nowrap;">${status}</span>`;
}

/** Responsive summary cards — 3 per row on desktop, 2 on mobile */
function summaryCards(items) {
  // Use table layout: 3 columns
  const rows = [];
  for (let i = 0; i < items.length; i += 3) {
    const cells = items.slice(i, i + 3);
    while (cells.length < 3) cells.push(null); // pad
    rows.push(cells);
  }
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
    ${rows.map(row => `
    <tr>
      ${row.map(item => item ? `
      <td width="33%" style="padding:4px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;">
          <tr><td style="padding:12px 8px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:${item.color || "#0D9A8F"};">${item.value}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:3px;line-height:1.4;">${item.label}</div>
          </td></tr>
        </table>
      </td>` : `<td width="33%" style="padding:4px;"></td>`).join("")}
    </tr>`).join("")}
  </table>`;
}

/** Data table — scrollable wrapper for small screens */
function tbl(headers, rows, empty = "No data.") {
  if (!rows.length) return `<p style="color:#9ca3af;font-size:13px;margin:6px 0;font-style:italic;">${empty}</p>`;
  return `
  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:8px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;min-width:400px;">
      <thead>
        <tr style="background:#0D9A8F;">
          ${headers.map(h => `<th style="color:#fff;padding:8px 10px;text-align:left;font-size:12px;font-weight:700;white-space:nowrap;">${h}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map((cells, i) => `
        <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f9fafb"};">
          ${cells.map(c => `<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${c ?? "—"}</td>`).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function sectionTitle(text) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px;">
    <tr><td style="border-bottom:2px solid #0D9A8F;padding-bottom:6px;">
      <span style="color:#0D9A8F;font-size:15px;font-weight:700;">${text}</span>
    </td></tr>
  </table>`;
}

function subTitle(text) {
  return `<p style="color:#374151;font-size:13px;font-weight:700;margin:14px 0 6px;">${text}</p>`;
}

function detailLink(text = "View on Portal") {
  return `<p style="margin:8px 0;font-size:12px;">
    <a href="${PORTAL_URL}" style="color:#0D9A8F;font-weight:600;text-decoration:none;">${text} &rarr;</a>
  </p>`;
}

/** PM card — header row + campaign table, fully table-based */
function pmCard({ pm, data }) {
  const campRows = [...data.campaigns]
    .sort((a, b) => b.calledWeek - a.calledWeek)
    .map(c => [
      c.name,
      badge(c.status),
      fmt(c.totalRecords),
      fmt(c.calledWeek),
      fmt(c.agents),
      fmt(c.registrations),
      fmt(c.regByRemark),
      pct(c.registrations, c.calledWeek),
    ]);

  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px;">
    <!-- PM header -->
    <tr style="background:#f0fdfa;">
      <td style="padding:12px 14px;border-bottom:1px solid #d1fae5;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <span style="font-weight:700;font-size:14px;color:#0D9A8F;">${pm.employeeName}</span><br>
              <span style="font-size:11px;color:#6b7280;">${pm.email}</span>
            </td>
          </tr>
          <tr><td style="padding-top:8px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${[
                  ["Total Records",   fmt(data.totalRecords),  "#374151"],
                  ["Calls This Week", fmt(data.calledWeek),    "#0D9A8F"],
                  ["Registrations",   fmt(data.registrations), "#16a34a"],
                  ["Reg by Remark",   fmt(data.regByRemark),   "#d97706"],
                  ["Active Agents",   fmt(data.agents),        "#2563eb"],
                ].map(([lbl, val, col]) => `
                <td style="padding:4px 12px 4px 0;white-space:nowrap;">
                  <span style="font-size:11px;color:#6b7280;">${lbl}</span><br>
                  <span style="font-size:14px;font-weight:700;color:${col};">${val}</span>
                </td>`).join("")}
              </tr>
            </table>
          </td></tr>
        </table>
      </td>
    </tr>
    <!-- Campaign table -->
    <tr><td style="padding:12px 14px;">
      ${tbl(
        ["Campaign", "Status", "Total Records", "Calls This Week", "Active Agents", "Registrations", "Reg by Remark", "Conv%"],
        campRows,
        "No active campaigns."
      )}
    </td></tr>
  </table>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function sendWeeklyReport() {
  const { default: User }        = await import("../models/userModel.js");
  const { default: Campaign }    = await import("../models/campaignModel.js");
  const { default: CallingData } = await import("../models/callingDataModal.js");
  const { default: CallHistory } = await import("../models/callHistoryModel.js");
  const { default: Contact }     = await import("../models/MasterDBModel/contactModel.js");

  const { start: weekStart, end: weekEnd } = previousWeekRangeIST();
  const weekLabel  = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;
  const reportedOn = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata",
  });

  // ── 1. Users ────────────────────────────────────────────────────────────────
  const users = await User.find(
    { role: { $in: ["program_manager", "database_manager", "presales_manager"] }, status: "active" },
    { _id: 1, employeeName: 1, email: 1, role: 1 }
  ).lean();

  const pmList       = users.filter(u => u.role === "program_manager");
  const dbMgrList    = users.filter(u => u.role === "database_manager");
  const presalesList = users.filter(u => u.role === "presales_manager");
  const pmIds        = pmList.map(u => u._id);
  const presalesIds  = presalesList.map(u => u._id);

  // ── 2. Active campaigns under PMs ──────────────────────────────────────────
  const allCampaigns = await Campaign.find(
    { programManager: { $in: pmIds }, status: "active" },
    { _id: 1, name: 1, status: 1, programManager: 1, createdAt: 1 }
  ).lean();

  const campIds = allCampaigns.map(c => c._id);
  const campMap = new Map(allCampaigns.map(c => [String(c._id), c]));

  // ── 3. Weekly calling stats ─────────────────────────────────────────────────
  const [callingAgg, totalRecordsAgg, agentsAgg, regByRemarkAgg] = await Promise.all([
    CallingData.aggregate([
      { $match: { CampaignId: { $in: campIds }, lastCallingDate: { $gte: weekStart, $lte: weekEnd } } },
      { $group: { _id: "$CampaignId", calledWeek: { $sum: 1 }, registrations: { $sum: { $cond: ["$isRegistered", 1, 0] } } } },
    ]),
    CallingData.aggregate([
      { $match: { CampaignId: { $in: campIds } } },
      { $group: { _id: "$CampaignId", totalRecords: { $sum: 1 } } },
    ]),
    CallingData.aggregate([
      { $match: { CampaignId: { $in: campIds }, lastCallingDate: { $gte: weekStart, $lte: weekEnd }, agentId: { $ne: null } } },
      { $group: { _id: "$CampaignId", agents: { $addToSet: "$agentId" } } },
    ]),
    CallHistory.aggregate([
      { $match: { campaign_id: { $in: campIds } } },
      { $unwind: "$chatHistory" },
      { $match: { "chatHistory.callingDate": { $gte: weekStart, $lte: weekEnd }, "chatHistory.remarks": { $in: REG_REMARKS } } },
      { $group: { _id: "$campaign_id", regByRemark: { $sum: 1 } } },
    ]),
  ]);

  const callingMap   = new Map(callingAgg.map(r    => [String(r._id), r]));
  const totalRecMap  = new Map(totalRecordsAgg.map(r => [String(r._id), r.totalRecords]));
  const agentsMap    = new Map(agentsAgg.map(r    => [String(r._id), (r.agents || []).length]));
  const regRemarkMap = new Map(regByRemarkAgg.map(r => [String(r._id), r.regByRemark]));

  // ── 4. Per-PM data ──────────────────────────────────────────────────────────
  const pmDataMap = new Map();
  for (const camp of allCampaigns) {
    const pmRefs    = Array.isArray(camp.programManager) ? camp.programManager : [camp.programManager];
    const stats     = callingMap.get(String(camp._id))  || {};
    const totalRecs = totalRecMap.get(String(camp._id)) || 0;
    const agents    = agentsMap.get(String(camp._id))   || 0;
    const regRemark = regRemarkMap.get(String(camp._id))|| 0;
    for (const pmRef of pmRefs) {
      const key = String(pmRef);
      if (!pmDataMap.has(key)) pmDataMap.set(key, { campaigns: [], calledWeek: 0, totalRecords: 0, registrations: 0, regByRemark: 0, agents: 0 });
      const d = pmDataMap.get(key);
      d.campaigns.push({ name: camp.name, status: camp.status, totalRecords: totalRecs, calledWeek: stats.calledWeek || 0, registrations: stats.registrations || 0, regByRemark: regRemark, agents });
      d.calledWeek    += stats.calledWeek    || 0;
      d.totalRecords  += totalRecs;
      d.registrations += stats.registrations || 0;
      d.regByRemark   += regRemark;
      d.agents        += agents;
    }
  }

  const pmRows     = pmList.map(pm => ({ pm, data: pmDataMap.get(String(pm._id)) || { campaigns: [], calledWeek: 0, totalRecords: 0, registrations: 0, regByRemark: 0, agents: 0 } }))
                           .sort((a, b) => b.data.calledWeek - a.data.calledWeek);
  const grandCalls = pmRows.reduce((s, r) => s + r.data.calledWeek,    0);
  const grandRegs  = pmRows.reduce((s, r) => s + r.data.registrations, 0);

  // ── 5. MasterDB (last week) ─────────────────────────────────────────────────
  const [masterTotal, masterByDay] = await Promise.all([
    Contact.countDocuments({ createdAt: { $gte: weekStart, $lte: weekEnd } }),
    Contact.aggregate([
      { $match: { createdAt: { $gte: weekStart, $lte: weekEnd } } },
      { $group: { _id: { $dateToString: { format: "%d %b", date: "$createdAt", timezone: "Asia/Kolkata" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // ── 6. Presales (last week) ─────────────────────────────────────────────────
  const [recentCampaigns, presalesDataAgg] = await Promise.all([
    Campaign.find({ createdAt: { $gte: weekStart, $lte: weekEnd } }, { _id: 1, name: 1, status: 1, createdAt: 1 }).lean(),
    presalesIds.length ? CallingData.aggregate([
      { $match: { UploadedBy: { $in: presalesIds }, createdAt: { $gte: weekStart, $lte: weekEnd }, dataSourceType: { $in: ["Kestone", "Client", "Both", "IndividualSearchKestone"] } } },
      { $group: { _id: { uploader: "$UploadedBy", campaign: "$CampaignId" }, total: { $sum: 1 }, assigned: { $sum: { $cond: [{ $ne: ["$agentId", null] }, 1, 0] } }, unassigned: { $sum: { $cond: [{ $eq: ["$agentId", null] }, 1, 0] } } } },
    ]) : [],
  ]);

  const presalesStatMap = new Map();
  for (const row of presalesDataAgg) {
    const key  = String(row._id.uploader);
    const camp = campMap.get(String(row._id.campaign));
    if (!presalesStatMap.has(key)) presalesStatMap.set(key, { total: 0, assigned: 0, unassigned: 0, campaigns: [] });
    const d = presalesStatMap.get(key);
    d.total += row.total; d.assigned += row.assigned; d.unassigned += row.unassigned;
    d.campaigns.push({ name: camp?.name || "Unknown", total: row.total, assigned: row.assigned, unassigned: row.unassigned });
  }

  // ── 7. Build HTML ────────────────────────────────────────────────────────────

  const overallCards = summaryCards([
    { label: "Total Calls",          value: fmt(grandCalls),  color: "#0D9A8F" },
    { label: "Registrations",        value: fmt(grandRegs),   color: "#16a34a" },
    { label: "Conversion Rate",      value: pct(grandRegs, grandCalls), color: "#7c3aed" },
    { label: "Active PMs",           value: pmRows.filter(r => r.data.calledWeek > 0).length, color: "#2563eb" },
    { label: "Active Campaigns",     value: allCampaigns.length, color: "#d97706" },
    { label: "MasterDB New Records", value: fmt(masterTotal), color: "#dc2626" },
  ]);

  const pmHtml = pmRows.length
    ? pmRows.map(r => pmCard(r)).join("")
    : `<p style="color:#9ca3af;font-size:13px;">No program managers found.</p>`;

  const dbHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
      <tr>
        <td style="padding:12px 16px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#dc2626;">${fmt(masterTotal)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:3px;">New contacts added to MasterDB during ${weekLabel}</div>
        </td>
      </tr>
    </table>
    ${tbl(["Date", "New Contacts Added"], masterByDay.map(r => [r._id, fmt(r.count)]), "No new contacts added in this period.")}`;

  const presalesHtml = `
    ${subTitle(`Campaigns Created (${weekLabel})`)}
    ${tbl(
      ["Campaign Name", "Status", "Created On"],
      [...recentCampaigns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(c => [c.name, badge(c.status), fmtDate(c.createdAt)]),
      "No campaigns created in this period."
    )}
    ${subTitle("Data Pushed by Presales Managers")}
    ${tbl(
      ["Manager", "Email", "Total Pushed", "Assigned", "Unassigned", "Campaign Breakdown"],
      presalesList.map(mgr => {
        const d = presalesStatMap.get(String(mgr._id)) || { total: 0, assigned: 0, unassigned: 0, campaigns: [] };
        return [
          mgr.employeeName, mgr.email, fmt(d.total),
          `<span style="color:#16a34a;font-weight:700;">${fmt(d.assigned)}</span>`,
          `<span style="color:#dc2626;font-weight:700;">${fmt(d.unassigned)}</span>`,
          d.campaigns.length
            ? d.campaigns.map(c => `${c.name}: ${fmt(c.total)} pushed, <span style="color:#16a34a">${fmt(c.assigned)} assigned</span>, <span style="color:#dc2626">${fmt(c.unassigned)} unassigned</span>`).join("<br>")
            : "<span style='color:#9ca3af'>No data pushed</span>",
        ];
      }),
      "No presales activity in this period."
    )}`;

  // ── Final email body ─────────────────────────────────────────────────────────
  const body = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td>

        <!-- Title -->
        <h2 style="color:#0D9A8F;font-size:18px;font-weight:700;margin:0 0 4px;">Weekly CRM Report</h2>
        <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">${weekLabel}</p>
        <p style="color:#9ca3af;font-size:12px;margin:0 0 20px;">Generated on ${reportedOn}</p>

        <!-- Summary -->
        ${sectionTitle("Overall Summary")}
        ${overallCards}

        <!-- PM -->
        ${sectionTitle("Program Manager — Weekly Performance (Active Campaigns)")}
        <p style="font-size:11px;color:#6b7280;margin:-8px 0 12px;line-height:1.6;">
          <b>Reg by Remark</b>: Agent explicitly selected <em>"Registered"</em> or
          <em>"Already Registered"</em> as call remark — manually confirmed during call.
          <b>Registrations</b> = final registration status on contact record
          (includes external uploads).
        </p>
        ${pmHtml}
        ${detailLink("View full PM report on Portal")}

        <!-- DB Manager -->
        ${sectionTitle("Database Manager — MasterDB Activity")}
        ${dbHtml}
        ${detailLink("View MasterDB on Portal")}

        <!-- Presales -->
        ${sectionTitle("Presales Manager — Activity")}
        ${presalesHtml}
        ${detailLink("View Presales Dashboard on Portal")}

      </td></tr>
    </table>`;

  const dateStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  await sendEmail(
    "Smruti.G@kestoneglobal.com",
    `CEP360 Weekly Report — ${weekLabel}`,
    body,
    { trigger: "WEEKLY_REPORT", bcc: ["aman.d@kestoneglobal.com", "ravinders@kestoneglobal.com"] }
  );
  console.log(`[WEEKLY-REPORT] Sent at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
}
