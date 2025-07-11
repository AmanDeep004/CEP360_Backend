import AWS from "aws-sdk";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

// Configure AWS SDK v2
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_S3_REGION_NAME,
});

const s3 = new AWS.S3();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/pdf",
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only images and PDF files are allowed"), false);
  }
};

export function getUploadSingle() {
  // Use memory storage, then upload to S3 in controller/service
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter,
  });
}

// Helper to upload to S3 after multer
export async function uploadToS3(file) {
  const ext = path.extname(file.originalname);
  const base = path.basename(file.originalname, ext);
  const timestamp = Date.now();
  const key = `uploads/${base}-${timestamp}${ext}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: "public-read",
  };

  await s3.upload(params).promise();
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION_NAME}.amazonaws.com/${key}`;
} 