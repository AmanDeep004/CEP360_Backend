import { getUploadSingle } from '../utils/upload.js';

const uploadSingle = getUploadSingle();

export const uploadSingleFile = (req, res) => {
  uploadSingle.single('file')(req, res, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Error uploading file', details: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return the S3 file URL
    res.json({ success: true, fileUrl: req.file.location });
  });
}; 