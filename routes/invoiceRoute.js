import { Router } from "express";
const router = Router();

import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getAllInvoices,
  getAllInvoicesData,
  getInvoicesByPMId,
  generateAllInvoices,
  getAgentInvoicesDataByMonth,
  updateAndGenerateInvoice,
  getAgentsByProgramManager,
  getInvoicesByPMAndMonth,
  getInvoicesOfAgent,
  getAllInvoicesOfPmMonthWise,
  getSalaryDashboard,
  downloadInvoicesZip,
  getInvoiceGenerationSettings,
  updateInvoiceGenerationSettings,
  getRecentMonthsSettings,
} from "../controllers/invoiceController.js";

import { protect, authorize } from "../middleware/authMiddleware.js";

// Protected Routes
router.post("/", protect, createInvoice);
// invoices of a pm data
router.get("/", protect, getAllInvoices);
// all invoice data
router.get("/allInvoiceData", protect, getAllInvoicesData);
router.get("/pm/:pmId", protect, getInvoicesByPMId);
// router.put("/:id", protect, updateInvoice);
router.delete("/:id", protect, deleteInvoice);
router.post("/generratAllInvoiceData", protect, generateAllInvoices);
router.get("/getAgentInvoicesDataByMonth", protect, getAgentInvoicesDataByMonth);
router.put("/updateAndGenerateInvoice", protect, updateAndGenerateInvoice);
router.get(
  "/getAgentsByProgramManager/:programManagerId/:month",
  protect,
  getAgentsByProgramManager
);
router.get("/getInvoicesByPMAndMonth/:pmId", protect, getInvoicesByPMAndMonth);
router.get("/getInvoicesOfAgent/:agentId", protect, getInvoicesOfAgent);
router.get(
  "/getAllInvoicesOfPmMonthWise/:pmId/:month",
  protect,
  getAllInvoicesOfPmMonthWise
);
router.get("/salaryDashboard", protect, getSalaryDashboard);
router.post("/downloadZip", protect, downloadInvoicesZip);

// Invoice generation per-month lock — RM only
router.get("/settings",        protect, authorize("resource_manager", "superadmin"), getInvoiceGenerationSettings);
router.put("/settings",        protect, authorize("resource_manager", "superadmin"), updateInvoiceGenerationSettings);
router.get("/settings/recent", protect, getRecentMonthsSettings);

// PM also needs to read settings for their selected month
router.get("/settings/status", protect, getInvoiceGenerationSettings);

export default router;
