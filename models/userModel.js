import { Schema, model } from "mongoose";
import pkg from "bcryptjs";
import jwt from "jsonwebtoken";
import { UserRoleEnum } from "../utils/enum.js";
const { genSalt, hash, compare } = pkg;
const { sign } = jwt;

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, "Please add a First Name"],
      trim: true,
      maxlength: [50, "Name cannot be more than 50 characters"],
    },
    lastName: {
      type: String,
      //required: [true, "Please add a lastName"],
      trim: true,
      maxlength: [50, "Name cannot be more than 50 characters"],
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
      default: UserRoleEnum.USER,
    },
  },
  {
    timestamps: true,
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
  return sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
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

export default model("User", userSchema);
