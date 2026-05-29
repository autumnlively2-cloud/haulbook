const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set. Server cannot start.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId   = payload.sub;
    req.userRole = payload.role || 'driver';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireOwner(req, res, next) {
  if (req.userRole !== 'owner') return res.status(403).json({ error: 'Owner account required' });
  next();
}

function requirePlan(...plans) {
  return (req, res, next) => {
    // Attach plan via token or DB lookup; here we rely on DB check in route handlers
    next();
  };
}

module.exports = { auth, requireOwner, JWT_SECRET };
