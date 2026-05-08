import axios from "axios";
import EmailLog from "../models/emailLogModel.js";

// Module-level token cache — persists for the lifetime of the process
let _cachedToken = null;
let _tokenExpiresAt = 0;

const TENANT_ID = process.env.MS_GRAPH_TENANT_ID;
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET;
const SENDER_EMAIL =
  process.env.MS_GRAPH_SENDER_EMAIL || "alert@kestoneglobal.biz";
const DISABLE_EMAIL = process.env.DISABLE_EMAIL === "true";

/**
 * Fetch an OAuth2 client-credentials token from Microsoft identity platform.
 * Re-uses cached token until 60 s before expiry.
 */
async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await axios.post(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  _cachedToken = response.data.access_token;
  // expires_in is in seconds
  _tokenExpiresAt = now + response.data.expires_in * 1000;
  return _cachedToken;
}

/**
 * Wraps plain HTML content in a Kestone branded email shell.
 */
function wrapInBrandTemplate(subject, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f8; font-family: Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: #0D9A8F; padding: 24px 32px; }
    .header img { height: 36px; }
    .header h1 { color: #ffffff; margin: 8px 0 0; font-size: 18px; font-weight: 600; }
    .body { padding: 32px; color: #374151; font-size: 14px; line-height: 1.7; }
    .body h2 { color: #0D9A8F; font-size: 16px; margin-top: 0; }
    .footer { background-color: #f4f6f8; padding: 16px 32px; font-size: 12px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>CEP360 — CRM Notification</h1>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      This is an automated notification from CEP360 CRM &bull; Kestone Global &bull; Do not reply to this email.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an email via Microsoft Graph API and persist a log entry.
 *
 * @param {string} toEmail   - Recipient email address
 * @param {string} subject   - Email subject
 * @param {string} htmlBody  - HTML content (will be wrapped in brand template)
 * @param {object} meta      - { trigger, campaignId?, recipientUserId? }
 */
export async function sendEmail(toEmail, subject, htmlBody, meta = {}) {
  if (DISABLE_EMAIL) return;
  if (!toEmail || !subject || !htmlBody) {
    console.warn(
      "[GraphMailer] sendEmail called with missing params — skipped"
    );
    return;
  }

  const { trigger, campaignId = null, recipientUserId = null } = meta;

  try {
    const accessToken = await getAccessToken();

    const payload = {
      message: {
        subject,
        from: {
          emailAddress: {
            name: "CEP 360",
            address: SENDER_EMAIL,
          },
        },
        body: {
          contentType: "HTML",
          content: wrapInBrandTemplate(subject, htmlBody),
        },
        toRecipients: [{ emailAddress: { address: toEmail } }],
      },
    };

    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `[GraphMailer] Email sent → ${toEmail} | Trigger: ${trigger} | Subject: ${subject}`
    );

    // Persist log — fire-and-forget, never block on this
    EmailLog.create({
      to: toEmail,
      subject,
      body: htmlBody,
      trigger,
      campaignId,
      recipientUserId,
      status: "sent",
    }).catch((e) =>
      console.error(`[GraphMailer] EmailLog save failed: ${e.message}`)
    );
  } catch (err) {
    const errorMessage = err?.response?.data?.error?.message || err.message;
    console.error(
      `[GraphMailer] Failed to send email to ${toEmail}: ${errorMessage}`
    );

    // Log the failure too
    EmailLog.create({
      to: toEmail,
      subject,
      body: htmlBody,
      trigger,
      campaignId,
      recipientUserId,
      status: "failed",
      errorMessage,
    }).catch((e) =>
      console.error(`[GraphMailer] EmailLog save failed: ${e.message}`)
    );
  }
}
