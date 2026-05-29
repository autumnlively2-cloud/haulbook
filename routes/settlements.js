const express = require('express');
const { auth, requireOwner, requirePlan } = require('../middleware/auth');
const { getSettlements, getSettlementsByDriver, createSettlement, updateSettlementStatus,
        getLoads, uid } = require('../db');

const router = express.Router();

// Owner: get all settlements for their drivers
// Driver: get their own settlements
router.get('/', auth, requirePlan('pro'), async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 200;
    const offset = parseInt(req.query.offset) || 0;
    const data = req.userRole === 'owner'
      ? await getSettlements(req.userId, limit, offset)
      : await getSettlementsByDriver(req.userId, limit, offset);
    res.json(data);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Owner: generate / create a settlement
router.post('/', auth, requireOwner, requirePlan('pro'), async (req, res) => {
  try {
    const { driver_id, period_start, period_end, pay_rate, pay_type, deductions, notes } = req.body;
    if (!driver_id || !period_start || !period_end)
      return res.status(400).json({ error: 'driver_id, period_start, period_end required' });

    // Auto-calculate gross from loads in period
    const { pool } = require('../db');
    const loadsR = await pool.query(
      `SELECT SUM(gross) AS total_gross, SUM(miles) AS total_miles
       FROM loads WHERE user_id=$1 AND date>=$2 AND date<=$3`,
      [driver_id, period_start, period_end]
    );
    const totalGross = parseFloat(loadsR.rows[0]?.total_gross) || 0;
    const totalMiles = parseFloat(loadsR.rows[0]?.total_miles) || 0;
    const rate   = parseFloat(pay_rate) || 0;
    const deduct = parseFloat(deductions) || 0;

    let grossPay = 0;
    if (pay_type === 'per_mile')    grossPay = totalMiles * rate;
    else if (pay_type === 'percent') grossPay = totalGross * (rate / 100);
    else if (pay_type === 'flat')    grossPay = rate;
    else grossPay = totalGross;

    const netPay = Math.max(0, grossPay - deduct);
    const row = {
      id: uid(), owner_id: req.userId, driver_id,
      period_start, period_end,
      gross_pay: grossPay, deductions: deduct, net_pay: netPay,
      pay_rate: rate, pay_type: pay_type||'per_mile',
      status: 'draft', notes: notes||'',
    };
    await createSettlement(row);
    res.json({ ok: true, id: row.id, gross_pay: grossPay, net_pay: netPay, total_miles: totalMiles, total_gross: totalGross });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Owner: mark settlement as paid/void
router.patch('/:id/status', auth, requireOwner, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['draft','paid','void'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await updateSettlementStatus(req.params.id, req.userId, status);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
