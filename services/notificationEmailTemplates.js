/**
 * Email body templates for CRM workflow notifications.
 * Each function returns an HTML string (no wrapping — the mailer adds the brand shell).
 */

/**
 * Trigger 1: Campaign created and assigned to a Program Manager.
 */
export function campaignAssignedToPMTemplate({ pmName, campaignName, startDate, endDate, clientName, brandName, createdByName }) {
  return `
    <h2>You have been assigned to a new campaign</h2>
    <p>Hi <strong>${pmName}</strong>,</p>
    <p>A new campaign has been created and you have been designated as the <strong>Program Manager</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Campaign Name</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${campaignName}</td></tr>
      ${clientName ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Client</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${clientName}</td></tr>` : ""}
      ${brandName ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Brand</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${brandName}</td></tr>` : ""}
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Start Date</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${startDate ? new Date(startDate).toDateString() : "—"}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">End Date</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${endDate ? new Date(endDate).toDateString() : "—"}</td></tr>
      ${createdByName ? `<tr><td style="padding:8px;color:#6b7280">Created By</td><td style="padding:8px">${createdByName}</td></tr>` : ""}
    </table>
    <p style="margin-top:24px;">Please log in to CEP360 to review and manage the campaign.</p>
  `;
}

/**
 * Trigger 2: Agent assigned to a campaign.
 */
export function agentAssignedToCampaignTemplate({ agentName, campaignName, clientName, brandName, startDate, endDate }) {
  return `
    <h2>You have been added to a campaign</h2>
    <p>Hi <strong>${agentName}</strong>,</p>
    <p>You have been assigned as a <strong>Calling Agent</strong> for the following campaign. Please log in to CEP360 to view your assigned contacts and begin calling.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Campaign Name</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${campaignName}</td></tr>
      ${clientName ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Client</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${clientName}</td></tr>` : ""}
      ${brandName ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Brand</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${brandName}</td></tr>` : ""}
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Campaign Period</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${startDate ? new Date(startDate).toDateString() : "—"} → ${endDate ? new Date(endDate).toDateString() : "—"}</td></tr>
    </table>
    <p style="margin-top:24px;">Log in to CEP360 to view your tasks.</p>
  `;
}

/**
 * Trigger 3: New calling data uploaded by Presales Manager — notify campaign PM(s).
 */
export function callingDataUploadedToPMTemplate({ pmName, campaignName, count, uploadedByName }) {
  return `
    <h2>New calling data added to your campaign</h2>
    <p>Hi <strong>${pmName}</strong>,</p>
    <p><strong>${count} new contact record${count !== 1 ? "s have" : " has"} been added</strong> to the campaign database by the Presales team.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Campaign</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${campaignName}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Records Added</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#0D9A8F">${count}</td></tr>
      ${uploadedByName ? `<tr><td style="padding:8px;color:#6b7280">Uploaded By</td><td style="padding:8px">${uploadedByName}</td></tr>` : ""}
    </table>
    <p style="margin-top:24px;">Log in to CEP360 to review and assign the new data to your agents.</p>
  `;
}

/**
 * Trigger 4: PM assigns calling data to an agent.
 */
export function callingDataAssignedToAgentTemplate({ agentName, campaignName, count, pmName }) {
  return `
    <h2>Calling data has been assigned to you</h2>
    <p>Hi <strong>${agentName}</strong>,</p>
    <p>Your Program Manager has assigned <strong>${count} contact record${count !== 1 ? "s" : ""}</strong> to you for calling.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Campaign</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${campaignName}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">Records Assigned</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#0D9A8F">${count}</td></tr>
      ${pmName ? `<tr><td style="padding:8px;color:#6b7280">Assigned By</td><td style="padding:8px">${pmName}</td></tr>` : ""}
    </table>
    <p style="margin-top:24px;">Please log in to CEP360 to start calling your assigned contacts.</p>
  `;
}

/**
 * Trigger 5: PM reassigns calling data to a different agent.
 */
export function callingDataReassignedToAgentTemplate({ agentName, campaignName, count }) {
  return `
    <h2>Calling data has been reassigned to you</h2>
    <p>Hi <strong>${agentName}</strong>,</p>
    <p><strong>${count} contact record${count !== 1 ? "s have" : " has"} been reassigned</strong> to you for calling.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Campaign</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${campaignName}</td></tr>
      <tr><td style="padding:8px;color:#6b7280">Records Reassigned</td><td style="padding:8px;font-weight:600;color:#0D9A8F">${count}</td></tr>
    </table>
    <p style="margin-top:24px;">Log in to CEP360 to view your updated contact list.</p>
  `;
}
