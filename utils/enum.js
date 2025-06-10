const UserRoleEnum = Object.freeze({
  ADMIN: "admin",
  PROGRAM_MANAGER: "program_manager",
  RESOURCE_MANAGER: "resource_manager",
  AGENT: "agent",
  DATABASE_MANAGER: "database_manager",
  PRESALES_MANAGER: "presales_manager",
});

const HTTPLOG = false; //true, false

// Export the enums
export { UserRoleEnum, HTTPLOG };
