import express from "express";
import { UploadData } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/upload", UploadData);

export default router;
