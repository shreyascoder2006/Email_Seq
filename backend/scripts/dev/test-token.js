const jwt = require('jsonwebtoken');
const { env } = require('./src/config/env');

const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, env.JWT_SECRET || 'fallback', { expiresIn: '1d' });
console.log(token);
