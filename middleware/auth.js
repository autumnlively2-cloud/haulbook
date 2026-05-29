const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set. Server cannot start.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const PLAN_RANK = { free: 0, pro: 1, business: 2 };

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

function requirePlan(minPlan) {
  return async (req, res, next) => {
    try {
      const { getUser } = require('../db');
      const user = await getUser(req.userId);
      if (!user) return res.status(401).json({ error: 'User not found' });
      const userRank = PLAN_RANK[user.plan] !== undefined ? PLAN_RANK[user.plan] : 0;
      const reqRank  = PLAN_RANK[minPlan]   !== undefined ? PLAN_RANK[minPlan]   : 1;
      if (userRank < reqRank) {
        return res.status(403).json({
          error: 'upgrade_required',
          message: 'This feature requires a ' + minPlan + ' plan or higher.',
          required_plan: minPlan,
        });
      }
      req.userPlan = user.plan;
      next();
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  };
}

module.exports = { auth, requireOwner, requirePlan, JWT_SECRET };
