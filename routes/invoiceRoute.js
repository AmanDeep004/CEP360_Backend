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
router.post("/", createInvoice);
// invoices of a pm data
router.get("/", getAllInvoices);
// all invoice data
router.get("/allInvoiceData", getAllInvoicesData);
router.get("/pm/:pmId", getInvoicesByPMId);
// router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);
router.post("/generratAllInvoiceData", generateAllInvoices);
router.get("/getAgentInvoicesDataByMonth", getAgentInvoicesDataByMonth);
router.put("/updateAndGenerateInvoice", updateAndGenerateInvoice);
router.get(
  "/getAgentsByProgramManager/:programManagerId/:month",
  getAgentsByProgramManager
);
router.get("/getInvoicesByPMAndMonth/:pmId", getInvoicesByPMAndMonth);
router.get("/getInvoicesOfAgent/:agentId", getInvoicesOfAgent);
router.get(
  "/getAllInvoicesOfPmMonthWise/:pmId/:month",
  getAllInvoicesOfPmMonthWise
);

export default router;
