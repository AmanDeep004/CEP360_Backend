import User from '../models/User.js';
import { decodeToken } from '../utils/token.js';

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  try {
    const decoded = decodeToken(token);

    // console.log('decoded: ', decoded);

    req.user = await User.findById(decoded.id).select('id, role');

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // console.log('user: ', req.user);

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token invalid' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    next();
  };
};

// export const authorizeSelf = (...roles) => {
//   return (req, res, next) => {
//     if (!roles.includes(req.user.role)) {
//       return res.status(403).json({ success: false, message: 'Access denied' });
//     }
//     if (!id !== req.user.id) {
//       return res.status(403).json({ success: false, message: 'Access denied' });
//     }
//     next();
//   };
// };