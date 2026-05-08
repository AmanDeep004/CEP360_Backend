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
  CHANNEL_PROGRAM: "Channel Program",
  LEAD_GENERATION: "Lead Generation",
  PROFILING_ACTIVITY: "Profiling Activity",
  REDEMPTION: "Redemption",
  REWARD: "REWARD",
  VIRTUAL_EVENT: "Virtual Event",
  ALL: [
    "Academic Program",
    "Association Program",
    "Audience Generation",
    "Channel Program",
    "Lead Generation",
    "Profiling Activity",
    "Redemption",
    "Reward",
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
  CAMPAIGN_ASSIGNED_TO_PM:         "CAMPAIGN_ASSIGNED_TO_PM",
  AGENT_ASSIGNED_TO_CAMPAIGN:      "AGENT_ASSIGNED_TO_CAMPAIGN",
  CALLING_DATA_UPLOADED:           "CALLING_DATA_UPLOADED",
  CALLING_DATA_ASSIGNED_TO_AGENT:  "CALLING_DATA_ASSIGNED_TO_AGENT",
  CALLING_DATA_REASSIGNED_TO_AGENT:"CALLING_DATA_REASSIGNED_TO_AGENT",
});

// Export the enums
export { UserRoleEnum, HTTPLOG, Constants, ProgramType, ProgramStatus, EmailTrigger };
