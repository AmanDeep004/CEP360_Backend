import User from '../models/User.js';

const registerUser = async (registerData) => {
    const { name, email, employeeId, password, role } = registerData;

    const userExists = await User.findOne({ email });
    if (userExists) throw new Error('User already exists');

    if (employeeId) {
        const employeeExists = await User.findOne({ employeeId });
        if (employeeExists) throw new Error('Employee ID already exists');
    }

    const user = await User.create({ name, email, employeeId, password, role });

    return user;
};

const loginUser = async (loginData) => {
    const { email, password } = loginData;
    
    const user = await User.findOne({ email }).select('+password');
    if (!user) throw new Error('Invalid credentials');

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new Error('Invalid credentials');

    return user;
};

const authService = { registerUser, loginUser };
export default authService;