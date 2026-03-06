import express from "express";
import { UploadData } from "../controllers/uploadController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/upload", protect, UploadData);

export default router;
