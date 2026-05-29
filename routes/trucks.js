const express = require('express');
const { auth, requireOwner } = require('../middleware/auth');
const { getTrucks, createTruck, updateTruck, deleteTruck, uid } = require('../db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    res.json(await getTrucks(req.userId));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, requireOwner, async (req, res) => {
  try {
    const { unit_number, year, make, model, vin, plate } = req.body;
    if (!unit_number) return res.status(400).json({ error: 'unit_number required' });
    const row = { id: uid(), owner_id: req.userId, unit_number, year: parseInt(year)||null, make: make||'', model: model||'', vin: vin||'', plate: plate||'', status: 'active' };
    await createTruck(row);
    res.json({ ok: true, id: row.id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, requireOwner, async (req, res) => {
  try {
    const { unit_number, year, make, model, vin, plate, status } = req.body;
    if (!unit_number) return res.status(400).json({ error: 'unit_number required' });
    await updateTruck({ id: req.params.id, owner_id: req.userId, unit_number, year: parseInt(year)||null, make: make||'', model: model||'', vin: vin||'', plate: plate||'', status: status||'active' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, requireOwner, async (req, res) => {
  try {
    await deleteTruck(req.params.id, req.userId);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
