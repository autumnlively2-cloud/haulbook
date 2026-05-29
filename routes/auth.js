const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { auth, JWT_SECRET } = require('../middleware/auth');
const { getUser, getUserByEmail, createUser, updateUser, uid } = require('../db');

const router  = express.Router();
const limiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });

function makeToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

router.post('/signup', limiter, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim() || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const assignedRole = role === 'owner' ? 'owner' : 'driver';
  try {
    const existing = await getUserByEmail(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const user = { id: uid(), name: name.trim(), email: email.toLowerCase(), password_hash: hash, role: assignedRole };
    await createUser(user);
    res.json({ token: makeToken(user), role: assignedRole, name: user.name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const user = await getUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: makeToken(user), role: user.role, name: user.name });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role,
               plan: user.plan, state: user.state, state_tax_rate: user.state_tax_rate });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/me', auth, async (req, res) => {
  const { name, state, state_tax_rate } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    await updateUser({ id: req.userId, name: name.trim(), state: state||'', state_tax_rate: parseFloat(state_tax_rate)||0 });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
