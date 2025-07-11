import express from 'express';
import { uploadSingleFile } from '../controllers/uploadController.js';

const router = express.Router();

router.post('/upload', uploadSingleFile);

export default router; 