/**
 * Generates 3 test Excel sheets for External Upload feature testing.
 * Output: C:/Users/Admin/Downloads/
 *
 * Run: node scripts/generateTestSheets.mjs
 */

import ExcelJS from "exceljs";
import path from "path";

const OUT = "C:/Users/Admin/Downloads";

const MANDATORY = [
  "Full_Name", "Job_Title", "Contact_City", "Mobile_No",
  "Office_Email_1", "Company_Name", "Registration_Status", "Registration_Date", "Is_Attended",
];
const OPTIONAL = [
  "First_Name", "Last_Name", "Gender", "Job_Seniority", "Job_Function",
  "Contact_State", "Contact_Country", "Company_Segment", "Industry",
];
const ALL_COLS = [...MANDATORY, ...OPTIONAL];

const styleHeader = (ws) => {
  const row = ws.getRow(1);
  ALL_COLS.forEach((col, i) => {
    const cell = row.getCell(i + 1);
    const isMand = MANDATORY.includes(col);
    cell.font  = { bold: true, color: { argb: isMand ? "FFCC0000" : "FF333333" } };
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: isMand ? "FFFFF0F0" : "FFF2F2F2" } };
    cell.alignment = { horizontal: "center" };
  });
  row.height = 20;
};

const addRows = (ws, rows) => rows.forEach(r => ws.addRow(ALL_COLS.map(c => r[c] ?? "")));

const makeWb = async (filename, sheetName, rows, note) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(ALL_COLS);
  styleHeader(ws);
  addRows(ws, rows);
  ws.columns = ALL_COLS.map(c => ({ width: MANDATORY.includes(c) ? 26 : 20 }));

  // Notes sheet
  const nsWs = wb.addWorksheet("Notes");
  note.forEach((line, i) => { nsWs.getRow(i + 1).getCell(1).value = line; });
  nsWs.getColumn(1).width = 80;

  await wb.xlsx.writeFile(path.join(OUT, filename));
  console.log(`✓ ${filename}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 1 — All valid, new records (should INSERT all 5)
// ─────────────────────────────────────────────────────────────────────────────
await makeWb(
  "test_01_valid_new_records.xlsx",
  "New Records",
  [
    {
      Full_Name: "Amit Sharma", First_Name: "Amit", Last_Name: "Sharma",
      Job_Title: "CTO", Job_Function: "Technology", Job_Seniority: "C-Suite",
      Contact_City: "Mumbai", Contact_State: "Maharashtra", Contact_Country: "India",
      Mobile_No: "9876543201", Office_Email_1: "amit.sharma@techcorp.in",
      Company_Name: "TechCorp India", Company_Segment: "Enterprise", Industry: "Technology",
      Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "yes",
    },
    {
      Full_Name: "Priya Mehta", First_Name: "Priya", Last_Name: "Mehta",
      Job_Title: "VP Marketing", Job_Function: "Marketing", Job_Seniority: "VP",
      Contact_City: "Bengaluru", Contact_State: "Karnataka", Contact_Country: "India",
      Mobile_No: "9876543202", Office_Email_1: "priya.mehta@infosys.com",
      Company_Name: "Infosys Ltd", Company_Segment: "Large", Industry: "IT Services",
      Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "no",
    },
    {
      Full_Name: "Rahul Verma", First_Name: "Rahul", Last_Name: "Verma",
      Job_Title: "IT Manager", Job_Function: "IT", Job_Seniority: "Manager",
      Contact_City: "Delhi", Contact_State: "Delhi", Contact_Country: "India",
      Mobile_No: "9876543203", Office_Email_1: "rahul.verma@wipro.com",
      Company_Name: "Wipro Technologies", Company_Segment: "Large", Industry: "IT Services",
      Registration_Status: "no", Registration_Date: "2026-07-15", Is_Attended: "no",
    },
    {
      Full_Name: "Sunita Rao", First_Name: "Sunita", Last_Name: "Rao",
      Job_Title: "Director", Job_Function: "Operations", Job_Seniority: "Director",
      Contact_City: "Hyderabad", Contact_State: "Telangana", Contact_Country: "India",
      Mobile_No: "9876543204", Office_Email_1: "sunita.rao@hcl.com",
      Company_Name: "HCL Technologies", Company_Segment: "Enterprise", Industry: "Technology",
      Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "yes",
    },
    {
      Full_Name: "Karan Patel", First_Name: "Karan", Last_Name: "Patel",
      Job_Title: "CEO", Job_Function: "Executive", Job_Seniority: "C-Suite",
      Contact_City: "Ahmedabad", Contact_State: "Gujarat", Contact_Country: "India",
      Mobile_No: "9876543205", Office_Email_1: "karan.patel@startupxyz.com",
      Company_Name: "StartupXYZ", Company_Segment: "SMB", Industry: "FinTech",
      Registration_Status: "yes", Registration_Date: "2026-07-13", Is_Attended: "yes",
    },
  ],
  [
    "TEST SHEET 1 — Valid New Records",
    "",
    "Expected Result:",
    "  → 5 rows inserted",
    "  → 0 validation failures",
    "  → 0 duplicates",
    "",
    "All mandatory fields are filled correctly.",
    "Registration_Status and Is_Attended use valid 'yes'/'no' values.",
    "All mobile numbers and emails are unique (not in DB yet).",
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 2 — Validation failures (should flag bad rows, insert only valid ones)
// ─────────────────────────────────────────────────────────────────────────────
await makeWb(
  "test_02_validation_failures.xlsx",
  "Mixed Rows",
  [
    // ROW 1 — Valid
    {
      Full_Name: "Neha Joshi", Job_Title: "Product Manager",
      Contact_City: "Pune", Mobile_No: "9876543301", Office_Email_1: "neha.joshi@product.com",
      Company_Name: "ProductCo", Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "yes",
    },
    // ROW 2 — Missing Full_Name
    {
      Full_Name: "", Job_Title: "Sales Head",
      Contact_City: "Chennai", Mobile_No: "9876543302", Office_Email_1: "noname@sales.com",
      Company_Name: "SalesCorp", Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "no",
    },
    // ROW 3 — Missing Mobile_No
    {
      Full_Name: "Ravi Shankar", Job_Title: "Architect",
      Contact_City: "Bengaluru", Mobile_No: "", Office_Email_1: "ravi.shankar@arch.com",
      Company_Name: "ArchFirm", Registration_Status: "no", Registration_Date: "2026-07-14", Is_Attended: "no",
    },
    // ROW 4 — Invalid Registration_Status (not yes/no)
    {
      Full_Name: "Deepa Nair", Job_Title: "HR Director",
      Contact_City: "Kochi", Mobile_No: "9876543303", Office_Email_1: "deepa.nair@hr.com",
      Company_Name: "HRSolutions", Registration_Status: "registered", Registration_Date: "2026-07-14", Is_Attended: "no",
    },
    // ROW 5 — Invalid Is_Attended (not yes/no)
    {
      Full_Name: "Arjun Kapoor", Job_Title: "Dev Lead",
      Contact_City: "Noida", Mobile_No: "9876543304", Office_Email_1: "arjun.kapoor@dev.com",
      Company_Name: "DevCorp", Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "maybe",
    },
    // ROW 6 — Missing Company_Name and Office_Email_1
    {
      Full_Name: "Pooja Singh", Job_Title: "CFO",
      Contact_City: "Mumbai", Mobile_No: "9876543305", Office_Email_1: "",
      Company_Name: "", Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "yes",
    },
    // ROW 7 — Valid
    {
      Full_Name: "Vikram Nanda", Job_Title: "COO",
      Contact_City: "Delhi", Mobile_No: "9876543306", Office_Email_1: "vikram.nanda@corp.com",
      Company_Name: "BigCorp India", Registration_Status: "no", Registration_Date: "2026-07-15", Is_Attended: "no",
    },
    // ROW 8 — Missing Registration_Date
    {
      Full_Name: "Meena Reddy", Job_Title: "CIO",
      Contact_City: "Hyderabad", Mobile_No: "9876543307", Office_Email_1: "meena.reddy@tech.com",
      Company_Name: "TechGroup", Registration_Status: "yes", Registration_Date: "", Is_Attended: "yes",
    },
  ],
  [
    "TEST SHEET 2 — Validation Failures",
    "",
    "Expected Result:",
    "  → 2 rows inserted (Row 1: Neha Joshi, Row 7: Vikram Nanda)",
    "  → 6 rows in 'Validation Failed' sheet:",
    "      Row 2 — Missing Full_Name",
    "      Row 3 — Missing Mobile_No",
    "      Row 4 — Registration_Status = 'registered' (must be yes/no)",
    "      Row 5 — Is_Attended = 'maybe' (must be yes/no)",
    "      Row 6 — Missing Office_Email_1 and Company_Name",
    "      Row 8 — Missing Registration_Date",
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 3 — Existing match + intra-file duplicates
// Upload test_01 first, then upload this file to test update + dedup behaviour
// ─────────────────────────────────────────────────────────────────────────────
await makeWb(
  "test_03_update_and_duplicates.xlsx",
  "Updates & Dupes",
  [
    // ROW 1 — Matches Sheet1 Row1 by Mobile_No → UPDATE registration
    {
      Full_Name: "Amit Sharma", Job_Title: "CTO",
      Contact_City: "Mumbai", Mobile_No: "9876543201", Office_Email_1: "amit.sharma@techcorp.in",
      Company_Name: "TechCorp India",
      Registration_Status: "yes", Registration_Date: "2026-07-16", Is_Attended: "yes",
    },
    // ROW 2 — Matches Sheet1 Row2 by Office_Email_1 → UPDATE registration
    {
      Full_Name: "Priya Mehta", Job_Title: "VP Marketing",
      Contact_City: "Bengaluru", Mobile_No: "9999000001", Office_Email_1: "priya.mehta@infosys.com",
      Company_Name: "Infosys Ltd",
      Registration_Status: "yes", Registration_Date: "2026-07-16", Is_Attended: "yes",
    },
    // ROW 3 — Completely new record → INSERT
    {
      Full_Name: "Fatima Khan", Job_Title: "Data Scientist",
      Contact_City: "Mumbai", Mobile_No: "9876543401", Office_Email_1: "fatima.khan@analytics.com",
      Company_Name: "Analytics Hub", Industry: "Analytics",
      Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "no",
    },
    // ROW 4 — Same mobile as Row 3 above (intra-file duplicate) → SKIP
    {
      Full_Name: "Fatima Khan Duplicate", Job_Title: "Data Scientist",
      Contact_City: "Mumbai", Mobile_No: "9876543401", Office_Email_1: "fatima.duplicate@analytics.com",
      Company_Name: "Analytics Hub",
      Registration_Status: "yes", Registration_Date: "2026-07-14", Is_Attended: "yes",
    },
    // ROW 5 — New record → INSERT
    {
      Full_Name: "Raj Malhotra", Job_Title: "CISO",
      Contact_City: "Delhi", Mobile_No: "9876543402", Office_Email_1: "raj.malhotra@security.com",
      Company_Name: "SecureNet", Industry: "Cybersecurity",
      Registration_Status: "no", Registration_Date: "2026-07-15", Is_Attended: "no",
    },
    // ROW 6 — Same email as Row 5 above (intra-file duplicate) → SKIP
    {
      Full_Name: "Raj Malhotra Copy", Job_Title: "CISO",
      Contact_City: "Delhi", Mobile_No: "9999000099", Office_Email_1: "raj.malhotra@security.com",
      Company_Name: "SecureNet",
      Registration_Status: "yes", Registration_Date: "2026-07-15", Is_Attended: "yes",
    },
    // ROW 7 — Matches Sheet1 Row4 by mobile → UPDATE (was yes/yes, now updating date)
    {
      Full_Name: "Sunita Rao", Job_Title: "Director",
      Contact_City: "Hyderabad", Mobile_No: "9876543204", Office_Email_1: "sunita.rao@hcl.com",
      Company_Name: "HCL Technologies",
      Registration_Status: "yes", Registration_Date: "2026-07-17", Is_Attended: "no",
    },
  ],
  [
    "TEST SHEET 3 — Updates + Intra-file Duplicates",
    "",
    "⚠ IMPORTANT: Upload test_01_valid_new_records.xlsx FIRST, then upload this file.",
    "",
    "Expected Result:",
    "  → 2 rows inserted (Row 3: Fatima Khan, Row 5: Raj Malhotra)",
    "  → 3 rows updated (Row 1: Amit Sharma, Row 2: Priya Mehta, Row 7: Sunita Rao)",
    "     matched by: Mobile_No (Row1, Row7), Office_Email_1 (Row2)",
    "     registrationSource → 'External Registration'",
    "  → 2 rows in 'Intra-file Duplicates' sheet (Row4, Row6)",
    "  → 0 validation failures",
  ]
);

console.log("\nAll 3 test sheets saved to Downloads.");
console.log("Upload order: test_01 first → then test_03 to verify update/dedup behaviour.");
