import { Router } from "express";
const router = Router();

import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getAllInvoices,
  getInvoicesByPMId,
  generateAllInvoices,
} from "../controllers/invoiceController.js";

import { protect } from "../middleware/authMiddleware.js";

// Protected Routes
router.post("/", createInvoice);
router.get("/", getAllInvoices);
router.get("/pm/:pmId", getInvoicesByPMId);
router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);
router.post("/generratAllInvoiceData", generateAllInvoices);

export default router;
