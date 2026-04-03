import { Schema, model } from "mongoose";
import pkg from "bcryptjs";
import jwt from "jsonwebtoken";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { UserRoleEnum } from "../utils/enum.js";
import { getPrimaryConnection } from "../config/db.js";
const { genSalt, hash, compare } = pkg;
const { sign } = jwt;

const PAN_ALGO = "aes-256-cbc";
const getPanKey = () => Buffer.from(process.env.PAN_ENCRYPTION_KEY, "hex");

const encryptPAN = (pan) => {
  const iv = randomBytes(16);
  const cipher = createCipheriv(PAN_ALGO, getPanKey(), iv);
  return iv.toString("hex") + ":" + cipher.update(pan, "utf8", "hex") + cipher.final("hex");
};

const decryptPAN = (encrypted) => {
  try {
    const [ivHex, data] = encrypted.split(":");
    if (!ivHex || !data) return encrypted; // plaintext fallback for existing data
    const decipher = createDecipheriv(PAN_ALGO, getPanKey(), Buffer.from(ivHex, "hex"));
    return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
  } catch {
    return encrypted; // return as-is if decryption fails (legacy plaintext)
  }
};

const {
  SUPERADMIN,
  ADMIN,
  PROGRAM_MANAGER,
  RESOURCE_MANAGER,
  AGENT,
  DATABASE_MANAGER,
  PRESALES_MANAGER,
} = UserRoleEnum;
const userSchema = new Schema(
  {
    employeeName: {
      type: String,
      required: [true, "Please add Employee name"],
      trim: true,
      maxlength: [50, "Name cannot be more than 50 characters"],
    },
    type: {
      type: String,
      enum: {
        values: ["KSTN", "KI", "TEMP", "CEP"],
      },
      trim: true,
    },
    employeeCode: {
      type: String,
      required: [true, "Employee code is required"],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },

    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: [
          SUPERADMIN,
          // ADMIN,
          RESOURCE_MANAGER,
          PROGRAM_MANAGER,
          DATABASE_MANAGER,
          AGENT,
          PRESALES_MANAGER,
        ],
        message: "{VALUE} is not a valid role",
      },
      default: "agent",
    },
    code: {
      type: String,
      trim: true,
    },
    lastLogin: {
      type: Date,
    },
    type: {
      type: String,
      required: [true, "Employee type is required"],
      trim: true,
    },
    employeeBase: {
      type: String,
      required: [true, "Employee base is required"],
      trim: true,
    },
    programName: {
      type: String,
      // required: [true, "Program name is required"],
      trim: true,
    },
    programType: {
      type: String,
      // required: [true, "Program type is required"],
      trim: true,
    },
    signature: {
      type: String,
      // required: [true, "Signature is required"],
      trim: true,
      default:
        "https://cdn.vosmos.live/CxoAdmin/image/1761718616440_download.png",
      set: (v) =>
        v && v.trim() !== ""
          ? v
          : "https://cdn.vosmos.live/CxoAdmin/image/1761718616440_download.png",
    },
    mobile: {
      type: Number,
      trim: true,
    },
    programManager: {
      type: String,
      // required: [true, "Program manager is required"],
      trim: true,
    },
    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
    },
    status: {
      type: String,
      required: [true, "Status is required"],
      enum: {
        values: ["active", "inactive", "pending"],
        message: "{VALUE} is not a valid status",
      },
      default: "active",
    },
    doj: {
      type: Date,
      required: [true, "Date of joining is required"],
    },
    pan: {
      type: String,
      trim: true,
      set: (v) => (v ? encryptPAN(v) : v),
      get: (v) => (v ? decryptPAN(v) : v),
    },
    ctc: {
      type: Number,
      // required: [true, "CTC is required"],
      min: [0, "CTC cannot be negative"],
    },
    telecmiId: {
      type: String,
      trim: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Encrypt password using bcrypt
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  const salt = await genSalt(10);
  this.password = await hash(this.password, salt);
});

// Sign JWT and return
userSchema.methods.getSignedJwtToken = function () {
  return sign({ id: this._id, tokenVersion: this.tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });
};

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  const user = await this.constructor.findById(this._id).select("+password");
  if (!user) {
    throw new Error("User not found");
  }
  return await compare(enteredPassword, user.password);
};

const User = getPrimaryConnection().model("User", userSchema);
export default User;
