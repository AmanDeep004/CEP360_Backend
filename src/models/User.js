import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT, DATABASE_MANAGER } from '../utils/constants.js';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  employeeCode: { type: String, required: true, unique: true  },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: [
      AGENT, 
      ADMIN, 
      PROGRAM_MANAGER, 
      DATABASE_MANAGER,
      RESOURCE_MANAGER 
    ],
    default: 'agent',
  },
  lastLogin: { type: Date },
  type: { type: String, required: true },
  employeeBase: { type: String, required: true },
  programName: { type: String, required: true },
  programType: { type: String, required: true },
  programManager: { type: String, required: true },
  location: { type: String, required: true },
  status: { type: String, required: true },
  doj: { type: String, required: true },
  pan: { type: String },
}, { timestamps: true });


userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);
