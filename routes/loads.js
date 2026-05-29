const express = require('express');
const { auth } = require('../middleware/auth');
const { getLoads, getLoadsByOwner, createLoad, updateLoad, deleteLoad, uid } = require('../db');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 500;
    const offset = parseInt(req.query.offset) || 0;
    const data = req.userRole === 'owner'
      ? await getLoadsByOwner(req.userId, limit, offset)
      : await getLoads(req.userId, limit, offset);
    res.json(data);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { truck_id, date, origin, destination, miles, rate_per_mile, gross, status, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const parsedMiles = parseFloat(miles) || 0;
    const parsedRate  = parseFloat(rate_per_mile) || 0;
    const parsedGross = parseFloat(gross) || (parsedMiles * parsedRate);
    const row = {
      id: uid(), user_id: req.userId, truck_id: truck_id||'',
      date, origin: origin||'', destination: destination||'',
      miles: parsedMiles, rate_per_mile: parsedRate, gross: parsedGross,
      status: status||'delivered', notes: notes||'', source: 'manual',
    };
    await createLoad(row);
    res.json({ ok: true, id: row.id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { truck_id, date, origin, destination, miles, rate_per_mile, gross, status, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const parsedMiles = parseFloat(miles) || 0;
    const parsedRate  = parseFloat(rate_per_mile) || 0;
    const parsedGross = parseFloat(gross) || (parsedMiles * parsedRate);
    const changed = await updateLoad({
      id: req.params.id, user_id: req.userId, truck_id: truck_id||'',
      date, origin: origin||'', destination: destination||'',
      miles: parsedMiles, rate_per_mile: parsedRate, gross: parsedGross,
      status: status||'delivered', notes: notes||'',
    });
    if (changed === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteLoad(req.params.id, req.userId);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
