const UserRoleEnum = Object.freeze({
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  PROGRAM_MANAGER: "program_manager",
  RESOURCE_MANAGER: "resource_manager",
  AGENT: "agent",
  DATABASE_MANAGER: "database_manager",
  PRESALES_MANAGER: "presales_manager",
  ALL: [
    "superadmin",
    "admin",
    "program_manager",
    "resource_manager",
    "agent",
    "database_manager",
    "presales_manager",
  ],
});

const Constants = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  COMPLETED: "completed",
});

const ProgramType = Object.freeze({
  ACADEMIC_PROGRAM: "Academic Program",
  ASSOCIATION_PROGRAM: "Association Program",
  AUDIENCE_GENERATION: "Audience Generation",
  LEAD_GENERATION: "Lead Generation",
  PROFILING_ACTIVITY: "Profiling Activity",
  REDEMPTION_PROGRAM: "Redemption Program",
  REWARD_PROGRAM: "Reward Program",
  CXO_EVENT: "CXO Event",
  VIRTUAL_EVENT: "Virtual Event",
  ALL: [
    "Academic Program",
    "Association Program",
    "Audience Generation",
    "Lead Generation",
    "Profiling Activity",
    "Redemption Program",
    "Reward Program",
    "CXO Event",
    "Virtual Event",
  ],
});

const ProgramStatus = Object.freeze({
  CONFIRMED: "Confirmed",
  PITCH: "Pitch",
  ACTIVE: "Active",
});

const HTTPLOG = false; //true, false

const EmailTrigger = Object.freeze({
  CAMPAIGN_ASSIGNED_TO_PM: "CAMPAIGN_ASSIGNED_TO_PM",
  AGENT_ASSIGNED_TO_CAMPAIGN: "AGENT_ASSIGNED_TO_CAMPAIGN",
  CALLING_DATA_UPLOADED: "CALLING_DATA_UPLOADED",
  CALLING_DATA_ASSIGNED_TO_AGENT: "CALLING_DATA_ASSIGNED_TO_AGENT",
  CALLING_DATA_REASSIGNED_TO_AGENT: "CALLING_DATA_REASSIGNED_TO_AGENT",
});

// ─── DND / Suppression ────────────────────────────────────────────────────────

/** Channels that support suppression */
const DND_CHANNEL = Object.freeze({
  CALLING:  "calling",
  EMAIL:    "email",
  WHATSAPP: "whatsapp",
});

/** Scopes for a suppression — determines how broadly it applies */
const DND_SCOPE = Object.freeze({
  CAMPAIGN: "campaign",  // only this campaign
  BRAND:    "brand",     // all campaigns for this client company
  GLOBAL:   "global",   // never contact via this channel ever again
});

/**
 * Agent-facing remark strings that trigger DND.
 * Keep in sync with the remark dropdown options in the frontend.
 */
const DND_REMARKS = Object.freeze({
  CAMPAIGN: "DND (For Current Campaign)",
  BRAND:    "DND (For Current Brand)",
  GLOBAL:   "DND (Never Call Again for Any Campaign)",
});

/** Reverse map: remark label → DND_SCOPE value */
const DND_REMARK_TO_SCOPE = Object.freeze({
  [DND_REMARKS.CAMPAIGN]: DND_SCOPE.CAMPAIGN,
  [DND_REMARKS.BRAND]:    DND_SCOPE.BRAND,
  [DND_REMARKS.GLOBAL]:   DND_SCOPE.GLOBAL,
});

// Export the enums
export {
  UserRoleEnum,
  HTTPLOG,
  Constants,
  ProgramType,
  ProgramStatus,
  EmailTrigger,
  DND_CHANNEL,
  DND_SCOPE,
  DND_REMARKS,
  DND_REMARK_TO_SCOPE,
};
