import AWS from "aws-sdk";
import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: `.env.local` });
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
//import s3 from "../config/s3.js";
const cdnBucket = process.env.CDN_LINK;
const bucket = process.env.AWS_BUCKET_NAME;
const uploadFile = async (bucketName, file, fileName, ContentType) => {
  try {
    var data = file;
    //var name = fileName + "_" + new Date().getTime();

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: data,
      ContentType: ContentType ?? "png",
      // ACL: 'public-read-write'
    };

    var s3upload = await s3.upload(params).promise();
    //console.log(`File uploaded successfully at ${s3upload.Location}`);
    //return {fileName:name, src:s3upload.Location}; //https://cdn.vosmos.live/bucketName/name
    let folder = bucketName.split(`${bucket}`)[1];
    console.log("folder: " + folder);

    console.log("SRC: " + `${cdnBucket}${folder}/${fileName}`);
    return { fileName: fileName, src: `${cdnBucket}${folder}/${fileName}` };
  } catch (err) {
    console.log(`Failed to save:: ${err}`);
    return "";
  }
};
export default uploadFile;
