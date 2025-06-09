import { format as _format, transports as _transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { HTTPLOG } from "../utils/enum.js";
const format = _format.combine(
  _format.json(),
  _format.timestamp(),
  _format.prettyPrint()
);
const transport1 = new DailyRotateFile({
  filename: "logfiles/application-%DATE%.log",
  zippedArchive: true,
  maxFiles: "14d",
});
const transport2 = new DailyRotateFile({
  level: "error",
  filename: "logfiles/application-error-%DATE%.log",
  zippedArchive: true,
  maxFiles: "30d",
});
const logger = {
  level: "silly",
  transports: [transport1],
  format: format,
  statusLevels: true,

  //https://github.com/bithavoc/express-winston#:~:text=StackDriver/Google%20Cloud%20Logging
  // metaField: null, //this causes the metadata to be stored at the root of the log entry
  // responseField: null, // this prevents the response from being included in the metadata (including body and status code)
  // requestWhitelist: ["headers", "query"], //these are not included in the standard StackDriver httpRequest
  // responseWhitelist: ["body"], // this populates the `res.body` so we can get the response size (not required)
  // dynamicMeta: (req, res) => {
  //   const httpRequest = {};
  //   const meta = {};
  //   if (req) {
  //     meta.httpRequest = httpRequest;
  //     httpRequest.requestMethod = req.method;
  //     httpRequest.requestUrl = `${req.protocol}://${req.get("host")}${
  //       req.originalUrl
  //     }`;
  //     httpRequest.protocol = `HTTP/${req.httpVersion}`;
  //     // httpRequest.remoteIp = req.ip // this includes both ipv6 and ipv4 addresses separated by ':'
  //     httpRequest.remoteIp =
  //       req.ip.indexOf(":") >= 0
  //         ? req.ip.substring(req.ip.lastIndexOf(":") + 1)
  //         : req.ip; // just ipv4
  //     httpRequest.requestSize = req.socket.bytesRead;
  //     httpRequest.userAgent = req.get("User-Agent");
  //     httpRequest.referrer = req.get("Referrer");
  //   }

  //   if (res) {
  //     meta.httpRequest = httpRequest;
  //     httpRequest.status = res.statusCode;
  //     httpRequest.latency = {
  //       seconds: Math.floor(res.responseTime / 1000),
  //       nanos: (res.responseTime % 1000) * 1000000,
  //     };
  //     if (res.body) {
  //       if (typeof res.body === "object") {
  //         httpRequest.responseSize = JSON.stringify(res.body).length;
  //       } else if (typeof res.body === "string") {
  //         httpRequest.responseSize = res.body.length;
  //       }
  //     }
  //   }
  //   return meta;
  // },
};
const expressWinstonErrorLogger = {
  level: "error",
  transports: [transport2],
  format: format,
  statusLevels: true,
  blacklistedMetaFields: ["exception", "os", "trace", "process"],
};
if (HTTPLOG) {
  logger.transports.push(new _transports.Console());
  expressWinstonErrorLogger.transports.push(new _transports.Console());
}
export { logger, expressWinstonErrorLogger };
