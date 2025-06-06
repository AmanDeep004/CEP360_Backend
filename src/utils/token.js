import jwt from 'jsonwebtoken';

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );
};

const decodeToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET);
}

export { generateToken, decodeToken };
