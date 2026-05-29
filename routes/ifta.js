const express = require('express');
const { auth } = require('../middleware/auth');
const { getIftaSummary } = require('../db');

const router = express.Router();

// GET /api/ifta?year=2025&quarter=2
router.get('/', auth, async (req, res) => {
  try {
    const year    = parseInt(req.query.year)    || new Date().getFullYear();
    const quarter = parseInt(req.query.quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    const data = await getIftaSummary(req.userId, year, quarter);
    res.json(data);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
