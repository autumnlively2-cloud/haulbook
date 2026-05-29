const express = require('express');
const { auth } = require('../middleware/auth');
const { getFuelLogs, createFuelLog, updateFuelLog, deleteFuelLog, uid } = require('../db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 500;
    const offset = parseInt(req.query.offset) || 0;
    res.json(await getFuelLogs(req.userId, limit, offset));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { truck_id, date, state, gallons, price_per_gal, total_cost, odometer, location } = req.body;
    if (!date || !state) return res.status(400).json({ error: 'date and state required' });
    const parsedGal   = parseFloat(gallons)     || 0;
    const parsedPrice = parseFloat(price_per_gal)|| 0;
    const parsedTotal = parseFloat(total_cost)  || (parsedGal * parsedPrice);
    const row = {
      id: uid(), user_id: req.userId, truck_id: truck_id||'',
      date, state: state.toUpperCase(), gallons: parsedGal,
      price_per_gal: parsedPrice, total_cost: parsedTotal,
      odometer: parseFloat(odometer)||0, location: location||'',
    };
    await createFuelLog(row);
    res.json({ ok: true, id: row.id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { truck_id, date, state, gallons, price_per_gal, total_cost, odometer, location } = req.body;
    if (!date || !state) return res.status(400).json({ error: 'date and state required' });
    const parsedGal   = parseFloat(gallons)     || 0;
    const parsedPrice = parseFloat(price_per_gal)|| 0;
    const parsedTotal = parseFloat(total_cost)  || (parsedGal * parsedPrice);
    const changed = await updateFuelLog({
      id: req.params.id, user_id: req.userId, truck_id: truck_id||'',
      date, state: state.toUpperCase(), gallons: parsedGal,
      price_per_gal: parsedPrice, total_cost: parsedTotal,
      odometer: parseFloat(odometer)||0, location: location||'',
    });
    if (changed === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteFuelLog(req.params.id, req.userId);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
