const AWSBucket = process.env.AWS_BUCKET_NAME;
import formidable from "formidable";
import uploadFile from "../services/aws-helper.js";
import UploadedFiles from "../models/uploadFilesModel.js";
import fs from "fs";

const parseForm = (req) => {
  return new Promise((resolve, reject) => {
    const form = formidable({ keepExtensions: true });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      } else {
        resolve({ fields, files });
      }
    });
  });
};

const upload = async (req) => {
  try {
    const { fields, files } = await parseForm(req);
    const type = fields.type?.[0];
    const subtype = fields.subType?.[0];
    if (files) {
      //const userId = req.user._id;

      const userId = "6846891806a8c26f44064f95";
      const filesDetails = files.file[0];
      //    console.log(filesDetails, "filesDetails");

      const fileData = fs.readFileSync(files.file[0].filepath);

      const getFileExtension = (filename) => {
        return filename.slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2);
      };
      const fileExtension = getFileExtension(files.file[0].originalFilename);
      const encodedFileName = encodeURIComponent(files.file[0].newFilename);
      //console.log(fileExtension,"fileExtension");

      var t = files.file[0].originalFilename.replace(/\s+/g, "");
      const ReportName = `${Date.now()}_${t}`;

      var upload = await uploadFile(
        `${AWSBucket}/` + type,
        fileData,
        ReportName,
        filesDetails.mimetype
      );
      if (upload.src) {
        var file = new UploadedFiles({
          userId,
          type,
          subtype,
          fileSrc: upload.src,
          // fileName: encodedFileName, //files.file[0].originalFilename,
          extension: fileExtension,
          originalName: files.file[0].originalFilename,
          mimeType: filesDetails.mimetype,
        });

        var filesData = await file.save();

        return {
          status: 200,
          message: "File uploaded successfully.",
          data: filesData,
        };
      } else {
        return {
          error: true,
          status: 400,
          message: "Error while uploading File",
          data: null,
        };
      }
    } else {
      return {
        error: true,
        status: 400,
        message: "Error while uploading File",
        data: null,
      };
    }
  } catch (error) {
    return {
      error: true,
      status: 404,
      message: error.message,
      data: null,
    };
  }
};

export default upload;
