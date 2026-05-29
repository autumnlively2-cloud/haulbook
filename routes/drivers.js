const express = require('express');
const bcrypt  = require('bcryptjs');
const { auth, requireOwner } = require('../middleware/auth');
const { getDriversByOwner, createUser, getUserByEmail, uid } = require('../db');

const router = express.Router();

// Owner: list all their drivers
router.get('/', auth, requireOwner, async (req, res) => {
  try {
    res.json(await getDriversByOwner(req.userId));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Owner: add/invite a driver (creates account if email not found)
router.post('/', auth, requireOwner, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email) return res.status(400).json({ error: 'name and email required' });
    const existing = await getUserByEmail(email.toLowerCase());
    if (existing) {
      // If already exists and unattached, attach to this owner
      if (existing.owner_id && existing.owner_id !== req.userId)
        return res.status(409).json({ error: 'Driver already belongs to another fleet' });
      const { pool } = require('../db');
      await pool.query('UPDATE users SET owner_id=$1 WHERE id=$2', [req.userId, existing.id]);
      return res.json({ ok: true, id: existing.id, existing: true });
    }
    const pass = password || Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(pass, 12);
    const driver = { id: uid(), name: name.trim(), email: email.toLowerCase(), password_hash: hash, role: 'driver', owner_id: req.userId };
    await createUser(driver);
    res.json({ ok: true, id: driver.id, temp_password: password ? undefined : pass });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Owner: remove driver from fleet (doesn't delete account)
router.delete('/:id', auth, requireOwner, async (req, res) => {
  try {
    const { pool } = require('../db');
    await pool.query('UPDATE users SET owner_id=NULL WHERE id=$1 AND owner_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
