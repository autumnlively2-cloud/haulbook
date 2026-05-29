require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3002;

['uploads','uploads/receipts'].forEach(d => fs.mkdirSync(path.join(__dirname, d), { recursive: true }));

// Stripe webhook needs raw body
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/loads',       require('./routes/loads'));
app.use('/api/expenses',    require('./routes/expenses'));
app.use('/api/fuel',        require('./routes/fuel'));
app.use('/api/trucks',      require('./routes/trucks'));
app.use('/api/drivers',     require('./routes/drivers'));
app.use('/api/settlements', require('./routes/settlements'));
app.use('/api/ifta',        require('./routes/ifta'));
app.use('/api/receipts',    require('./routes/receipts'));

// Dashboard summary
const { auth } = require('./middleware/auth');
const { getUser, getDashboardTotals, getMonthlyLoads, getDriversByOwner, getTrucks, getLoads } = require('./db');

app.get('/api/summary', auth, async (req, res) => {
  try {
    const [user, totals, monthly] = await Promise.all([
      getUser(req.userId),
      getDashboardTotals(req.userId),
      getMonthlyLoads(req.userId),
    ]);
    const grossIncome = parseFloat(totals.loads.total)    || 0;
    const totalExp    = parseFloat(totals.expenses.total) || 0;
    const totalFuel   = parseFloat(totals.fuel.total)     || 0;
    const totalMiles  = parseFloat(totals.loads.miles)    || 0;
    const loadCount   = parseInt(totals.loads.cnt)        || 0;
    const netProfit   = grossIncome - totalExp;
    const seTax       = Math.max(0, netProfit * 0.9235 * 0.153);
    const fedTax      = Math.max(0, netProfit * 0.12);
    const stateTax    = Math.max(0, netProfit * (user.state_tax_rate || 0) / 100);

    let ownerData = null;
    if (user.role === 'owner') {
      const [drivers, trucks] = await Promise.all([
        getDriversByOwner(req.userId),
        getTrucks(req.userId),
      ]);
      ownerData = { driver_count: drivers.length, truck_count: trucks.length };
    }

    res.json({
      grossIncome, totalExp, totalFuel, totalMiles, loadCount, netProfit,
      seTax, fedTax, stateTax, totalTax: seTax + fedTax + stateTax,
      quarterly: (seTax + fedTax + stateTax) / 4,
      monthly,
      owner: ownerData,
      user: { id: user.id, name: user.name, email: user.email, role: user.role,
              plan: user.plan, state: user.state, state_tax_rate: user.state_tax_rate },
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const { initDb } = require('./db');
initDb()
  .then(() => app.listen(PORT, () => {
    console.log(`\n🚛 HaulBook running on http://localhost:${PORT}`);
    console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? '✓' : '✗'}`);
    console.log(`   AI Scan: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
    console.log(`   DB: ${process.env.DATABASE_URL ? '✓ PostgreSQL' : '✗ DATABASE_URL missing'}\n`);
  }))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
