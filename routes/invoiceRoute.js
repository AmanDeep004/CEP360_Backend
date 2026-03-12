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
} from "../controllers/invoiceController.js";

import { protect } from "../middleware/authMiddleware.js";

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

export default router;
