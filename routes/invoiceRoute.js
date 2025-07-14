import { Router } from "express";
const router = Router();

import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getAllInvoices,
  getInvoicesByPMId,
  generateAllInvoices,
  getAgentInvoicesDataByMonth,
  updateAndGenerateInvoice,
  getAgentsByProgramManager,
} from "../controllers/invoiceController.js";

import { protect } from "../middleware/authMiddleware.js";

// Protected Routes
router.post("/", createInvoice);
router.get("/", getAllInvoices);
router.get("/pm/:pmId", getInvoicesByPMId);
router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);
router.post("/generratAllInvoiceData", generateAllInvoices);
router.get("/getAgentInvoicesDataByMonth", getAgentInvoicesDataByMonth);
router.put("/updateAndGenerateInvoice", updateAndGenerateInvoice);
router.get(
  "/getAgentsByProgramManager/:programManagerId",
  getAgentsByProgramManager
);

export default router;
