import User from '../models/User.js';
import mongoose from 'mongoose';

const createUser = async (data) => {

    const userData = {
        employeeCode: data.employeeCode,
        password: data.password,
        role: data.role,
        email: data.email,
        name: data.name,
        lastLogin: data.lastLogin,
        type: data.type,
        employeeBase: data.employeeBase,
        programName: data.programName,
        programType: data.programType,
        programManager: data.programManager,
        location: data.location,
        status: data.status,
        doj: data.doj,
        pan: data.pan
    };

    const { email, employeeCode } = userData;
    const userExists = await User.findOne({ $or: [{ email }, { employeeCode }] });
    if (userExists) throw new Error('User with this email or employee code already exists');

    const user = await User.create(userData);
    return user;
};

const validateId = (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid user ID');
    }
};

const updateUser = async (id, data) => {
    validateId(id);

    const userData = {
        ...(data.username && { username: data.username }),
        ...(data.password && { password: data.password }),
        ...(data.role && { role: data.role }),
        ...(data.email && { email: data.email }),
        ...(data.name && { name: data.name }),
        ...(data.lastLogin && { lastLogin: data.lastLogin }),
        ...(data.type && { type: data.type }),
        ...(data.employeeBase && { employeeBase: data.employeeBase }),
        ...(data.programName && { programName: data.programName }),
        ...(data.programType && { programType: data.programType }),
        ...(data.programManage && { programManage: data.programManage }),
        ...(data.location && { location: data.location }),
        ...(data.status && { status: data.status }),
        ...(data.doj && { doj: data.doj }),
        ...(data.pan && { pan: data.pan })
    };

    const user = await User.findByIdAndUpdate(id, { $set: userData }, { new: true });
    if (!user) throw new Error('User not found');

    return user;
};

const deleteUser = async (id) => {
    validateId(id);

    const user = await User.findByIdAndDelete(id);
    if (!user) throw new Error('User not found');
};

const getUser = async (id) => {
    validateId(id);

    const user = await User.findById(id).select('employeeCode role email name lastLogin type employeeBase programName programType programManager location status doj pan');
    if (!user) throw new Error('User not found');

    return user;
};

const getAllUsers = async (role) => {
    const query = role ? { role } : {};
   
    const users = await User.find(query).select('employeeCode role email name lastLogin type employeeBase programName programType programManager location status doj pan');
   
    return users;
};

const userService = { createUser, updateUser, deleteUser, getUser, getAllUsers };
export default userService;