const express = require('express');
const { auth } = require('../middleware/auth');
const { getExpenses, getExpensesByOwner, createExpense, updateExpense, deleteExpense, uid } = require('../db');

const router = express.Router();
const CATEGORIES = ['Fuel','Maintenance','Tires','Insurance','Permits & Licenses','Tolls & Scales',
  'Meals','Lodging','Phone & Data','Equipment','Lumper Fees','Parking','Other'];

router.get('/', auth, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 500;
    const offset = parseInt(req.query.offset) || 0;
    const data = req.userRole === 'owner'
      ? await getExpensesByOwner(req.userId, limit, offset)
      : await getExpenses(req.userId, limit, offset);
    res.json(data);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { truck_id, date, category, description, amount, business_pct } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: 'date, category, amount required' });
    const row = {
      id: uid(), user_id: req.userId, truck_id: truck_id||'',
      date, category, description: description||'',
      amount: parseFloat(amount)||0, business_pct: parseFloat(business_pct)||100,
    };
    await createExpense(row);
    res.json({ ok: true, id: row.id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { truck_id, date, category, description, amount, business_pct } = req.body;
    if (!date || !category || !amount) return res.status(400).json({ error: 'date, category, amount required' });
    const changed = await updateExpense({
      id: req.params.id, user_id: req.userId, truck_id: truck_id||'',
      date, category, description: description||'',
      amount: parseFloat(amount)||0, business_pct: parseFloat(business_pct)||100,
    });
    if (changed === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteExpense(req.params.id, req.userId);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
