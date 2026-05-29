require('dotenv').config();
const { Pool } = require('pg');
const crypto   = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function uid() { return crypto.randomUUID(); }

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'driver',
      owner_id      TEXT,
      plan          TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id      TEXT DEFAULT '',
      stripe_subscription_id  TEXT DEFAULT '',
      state         TEXT DEFAULT '',
      state_tax_rate DOUBLE PRECISION DEFAULT 0,
      phone         TEXT DEFAULT '',
      mfa_method    TEXT DEFAULT 'none',
      otp_hash      TEXT DEFAULT '',
      otp_expires   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add MFA columns if upgrading existing DB
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT DEFAULT 'none';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_hash TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS trucks (
      id           TEXT PRIMARY KEY,
      owner_id     TEXT NOT NULL,
      unit_number  TEXT NOT NULL,
      year         INTEGER,
      make         TEXT DEFAULT '',
      model        TEXT DEFAULT '',
      vin          TEXT DEFAULT '',
      plate        TEXT DEFAULT '',
      status       TEXT DEFAULT 'active',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS driver_trucks (
      driver_id TEXT NOT NULL,
      truck_id  TEXT NOT NULL,
      PRIMARY KEY (driver_id, truck_id)
    );

    CREATE TABLE IF NOT EXISTS loads (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      truck_id     TEXT DEFAULT '',
      date         TEXT NOT NULL,
      origin       TEXT DEFAULT '',
      destination  TEXT DEFAULT '',
      miles        DOUBLE PRECISION DEFAULT 0,
      rate_per_mile DOUBLE PRECISION DEFAULT 0,
      gross        DOUBLE PRECISION DEFAULT 0,
      status       TEXT DEFAULT 'delivered',
      notes        TEXT DEFAULT '',
      source       TEXT DEFAULT 'manual',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      truck_id     TEXT DEFAULT '',
      date         TEXT NOT NULL,
      category     TEXT NOT NULL,
      description  TEXT DEFAULT '',
      amount       DOUBLE PRECISION DEFAULT 0,
      business_pct DOUBLE PRECISION DEFAULT 100,
      receipt_url  TEXT DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fuel_logs (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      truck_id       TEXT DEFAULT '',
      date           TEXT NOT NULL,
      state          TEXT NOT NULL,
      gallons        DOUBLE PRECISION DEFAULT 0,
      price_per_gal  DOUBLE PRECISION DEFAULT 0,
      total_cost     DOUBLE PRECISION DEFAULT 0,
      odometer       DOUBLE PRECISION DEFAULT 0,
      location       TEXT DEFAULT '',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id           TEXT PRIMARY KEY,
      owner_id     TEXT NOT NULL,
      driver_id    TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end   TEXT NOT NULL,
      gross_pay    DOUBLE PRECISION DEFAULT 0,
      deductions   DOUBLE PRECISION DEFAULT 0,
      net_pay      DOUBLE PRECISION DEFAULT 0,
      pay_rate     DOUBLE PRECISION DEFAULT 0,
      pay_type     TEXT DEFAULT 'per_mile',
      status       TEXT DEFAULT 'draft',
      notes        TEXT DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('HaulBook DB initialized');
}

// ─── Users ───────────────────────────────────────────
async function getUser(id) {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getUserByEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return r.rows[0] || null;
}
async function createUser(u) {
  await pool.query(
    `INSERT INTO users (id,name,email,password_hash,role,owner_id,plan)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [u.id, u.name, u.email, u.password_hash, u.role || 'driver', u.owner_id || null, 'free']
  );
}
async function updateUser(u) {
  await pool.query(
    `UPDATE users SET name=$2,state=$3,state_tax_rate=$4 WHERE id=$1`,
    [u.id, u.name, u.state || '', u.state_tax_rate || 0]
  );
}
async function setUserPlan(u) {
  await pool.query(
    `UPDATE users SET plan=$2,stripe_customer_id=$3,stripe_subscription_id=$4 WHERE id=$1`,
    [u.id, u.plan, u.stripe_customer_id || '', u.stripe_subscription_id || '']
  );
}
async function setUserPlanByCustomerId(customerId, plan) {
  await pool.query('UPDATE users SET plan=$2 WHERE stripe_customer_id=$1', [customerId, plan]);
}
async function getDriversByOwner(ownerId) {
  const r = await pool.query(
    `SELECT id,name,email,role,plan,created_at FROM users WHERE owner_id=$1 ORDER BY name`,
    [ownerId]
  );
  return r.rows;
}

// ─── Trucks ──────────────────────────────────────────
async function getTrucks(ownerId) {
  const r = await pool.query('SELECT * FROM trucks WHERE owner_id=$1 ORDER BY unit_number', [ownerId]);
  return r.rows;
}
async function getTruck(id) {
  const r = await pool.query('SELECT * FROM trucks WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function createTruck(t) {
  await pool.query(
    `INSERT INTO trucks (id,owner_id,unit_number,year,make,model,vin,plate,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [t.id, t.owner_id, t.unit_number, t.year||null, t.make||'', t.model||'', t.vin||'', t.plate||'', t.status||'active']
  );
}
async function updateTruck(t) {
  await pool.query(
    `UPDATE trucks SET unit_number=$2,year=$3,make=$4,model=$5,vin=$6,plate=$7,status=$8
     WHERE id=$1 AND owner_id=$9`,
    [t.id, t.unit_number, t.year||null, t.make||'', t.model||'', t.vin||'', t.plate||'', t.status||'active', t.owner_id]
  );
}
async function deleteTruck(id, ownerId) {
  await pool.query('DELETE FROM trucks WHERE id=$1 AND owner_id=$2', [id, ownerId]);
}

// ─── Loads ───────────────────────────────────────────
async function getLoads(userId, limit=500, offset=0) {
  const r = await pool.query(
    'SELECT * FROM loads WHERE user_id=$1 ORDER BY date DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset]
  );
  return r.rows;
}
async function getLoadsByOwner(ownerId, limit=500, offset=0) {
  const r = await pool.query(
    `SELECT l.*,u.name AS driver_name FROM loads l
     JOIN users u ON u.id=l.user_id
     WHERE u.owner_id=$1 OR l.user_id=$1
     ORDER BY l.date DESC LIMIT $2 OFFSET $3`,
    [ownerId, limit, offset]
  );
  return r.rows;
}
async function createLoad(l) {
  await pool.query(
    `INSERT INTO loads (id,user_id,truck_id,date,origin,destination,miles,rate_per_mile,gross,status,notes,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [l.id, l.user_id, l.truck_id||'', l.date, l.origin||'', l.destination||'',
     l.miles||0, l.rate_per_mile||0, l.gross||0, l.status||'delivered', l.notes||'', l.source||'manual']
  );
}
async function updateLoad(l) {
  const r = await pool.query(
    `UPDATE loads SET truck_id=$3,date=$4,origin=$5,destination=$6,miles=$7,
     rate_per_mile=$8,gross=$9,status=$10,notes=$11
     WHERE id=$1 AND user_id=$2`,
    [l.id, l.user_id, l.truck_id||'', l.date, l.origin||'', l.destination||'',
     l.miles||0, l.rate_per_mile||0, l.gross||0, l.status||'delivered', l.notes||'']
  );
  return r.rowCount;
}
async function deleteLoad(id, userId) {
  await pool.query('DELETE FROM loads WHERE id=$1 AND user_id=$2', [id, userId]);
}

// ─── Expenses ────────────────────────────────────────
async function getExpenses(userId, limit=500, offset=0) {
  const r = await pool.query(
    'SELECT * FROM expenses WHERE user_id=$1 ORDER BY date DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset]
  );
  return r.rows;
}
async function getExpensesByOwner(ownerId, limit=500, offset=0) {
  const r = await pool.query(
    `SELECT e.*,u.name AS driver_name FROM expenses e
     JOIN users u ON u.id=e.user_id
     WHERE u.owner_id=$1 OR e.user_id=$1
     ORDER BY e.date DESC LIMIT $2 OFFSET $3`,
    [ownerId, limit, offset]
  );
  return r.rows;
}
async function createExpense(e) {
  await pool.query(
    `INSERT INTO expenses (id,user_id,truck_id,date,category,description,amount,business_pct,receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.id, e.user_id, e.truck_id||'', e.date, e.category, e.description||'',
     e.amount||0, e.business_pct||100, e.receipt_url||'']
  );
}
async function updateExpense(e) {
  const r = await pool.query(
    `UPDATE expenses SET truck_id=$3,date=$4,category=$5,description=$6,amount=$7,business_pct=$8
     WHERE id=$1 AND user_id=$2`,
    [e.id, e.user_id, e.truck_id||'', e.date, e.category, e.description||'', e.amount||0, e.business_pct||100]
  );
  return r.rowCount;
}
async function deleteExpense(id, userId) {
  await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [id, userId]);
}

// ─── Fuel Logs ───────────────────────────────────────
async function getFuelLogs(userId, limit=500, offset=0) {
  const r = await pool.query(
    'SELECT * FROM fuel_logs WHERE user_id=$1 ORDER BY date DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset]
  );
  return r.rows;
}
async function createFuelLog(f) {
  await pool.query(
    `INSERT INTO fuel_logs (id,user_id,truck_id,date,state,gallons,price_per_gal,total_cost,odometer,location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.id, f.user_id, f.truck_id||'', f.date, f.state, f.gallons||0,
     f.price_per_gal||0, f.total_cost||0, f.odometer||0, f.location||'']
  );
}
async function updateFuelLog(f) {
  const r = await pool.query(
    `UPDATE fuel_logs SET truck_id=$3,date=$4,state=$5,gallons=$6,price_per_gal=$7,
     total_cost=$8,odometer=$9,location=$10
     WHERE id=$1 AND user_id=$2`,
    [f.id, f.user_id, f.truck_id||'', f.date, f.state, f.gallons||0,
     f.price_per_gal||0, f.total_cost||0, f.odometer||0, f.location||'']
  );
  return r.rowCount;
}
async function deleteFuelLog(id, userId) {
  await pool.query('DELETE FROM fuel_logs WHERE id=$1 AND user_id=$2', [id, userId]);
}

// ─── IFTA Summary ─────────────────────────────────────
async function getIftaSummary(userId, year, quarter) {
  const months = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] }[quarter] || [1,2,3,4,5,6,7,8,9,10,11,12];
  const startMo = String(months[0]).padStart(2,'0');
  const endMo   = String(months[months.length-1]).padStart(2,'0');
  const start   = `${year}-${startMo}-01`;
  const end     = `${year}-${endMo}-31`;

  const fuelR = await pool.query(
    `SELECT state, SUM(gallons) AS gallons, SUM(total_cost) AS total_cost
     FROM fuel_logs WHERE user_id=$1 AND date>=$2 AND date<=$3
     GROUP BY state ORDER BY state`,
    [userId, start, end]
  );
  return { fuel_by_state: fuelR.rows, period: { year, quarter, start, end } };
}

// ─── Settlements ─────────────────────────────────────
async function getSettlements(ownerId, limit=200, offset=0) {
  const r = await pool.query(
    `SELECT s.*,u.name AS driver_name FROM settlements s
     JOIN users u ON u.id=s.driver_id
     WHERE s.owner_id=$1 ORDER BY s.period_start DESC LIMIT $2 OFFSET $3`,
    [ownerId, limit, offset]
  );
  return r.rows;
}
async function getSettlementsByDriver(driverId, limit=200, offset=0) {
  const r = await pool.query(
    `SELECT s.*,u.name AS owner_name FROM settlements s
     JOIN users u ON u.id=s.owner_id
     WHERE s.driver_id=$1 ORDER BY s.period_start DESC LIMIT $2 OFFSET $3`,
    [driverId, limit, offset]
  );
  return r.rows;
}
async function createSettlement(s) {
  await pool.query(
    `INSERT INTO settlements (id,owner_id,driver_id,period_start,period_end,gross_pay,deductions,net_pay,pay_rate,pay_type,status,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [s.id, s.owner_id, s.driver_id, s.period_start, s.period_end,
     s.gross_pay||0, s.deductions||0, s.net_pay||0, s.pay_rate||0,
     s.pay_type||'per_mile', s.status||'draft', s.notes||'']
  );
}
async function updateSettlementStatus(id, ownerId, status) {
  await pool.query(
    'UPDATE settlements SET status=$3 WHERE id=$1 AND owner_id=$2',
    [id, ownerId, status]
  );
}

// ─── Dashboard Totals ────────────────────────────────
async function getDashboardTotals(userId) {
  const [loadsR, expR, fuelR] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(gross),0) AS total, COUNT(*) AS cnt, COALESCE(SUM(miles),0) AS miles
                FROM loads WHERE user_id=$1`, [userId]),
    pool.query(`SELECT COALESCE(SUM(amount*business_pct/100),0) AS total FROM expenses WHERE user_id=$1`, [userId]),
    pool.query(`SELECT COALESCE(SUM(total_cost),0) AS total, COALESCE(SUM(gallons),0) AS gallons
                FROM fuel_logs WHERE user_id=$1`, [userId]),
  ]);
  return {
    loads:    loadsR.rows[0],
    expenses: expR.rows[0],
    fuel:     fuelR.rows[0],
  };
}

async function getMonthlyLoads(userId) {
  const r = await pool.query(
    `SELECT TO_CHAR(date::date,'YYYY-MM') AS mo,
            COALESCE(SUM(gross),0) AS gross,
            COALESCE(SUM(miles),0) AS miles,
            COUNT(*) AS cnt
     FROM loads WHERE user_id=$1
       AND date >= (NOW() - INTERVAL '12 months')::date::text
     GROUP BY mo ORDER BY mo`,
    [userId]
  );
  return r.rows;
}


// ─── OTP / MFA ───────────────────────────────────────
async function saveOTP(userId, otpHash, expiresAt) {
  await pool.query(
    'UPDATE users SET otp_hash=$2, otp_expires=$3 WHERE id=$1',
    [userId, otpHash, expiresAt]
  );
}
async function clearOTP(userId) {
  await pool.query(
    "UPDATE users SET otp_hash='', otp_expires=NULL WHERE id=$1",
    [userId]
  );
}
async function updateMFA(userId, phone, mfaMethod) {
  await pool.query(
    'UPDATE users SET phone=$2, mfa_method=$3 WHERE id=$1',
    [userId, phone || '', mfaMethod || 'email']
  );
}

module.exports = {
  saveOTP, clearOTP, updateMFA,
  pool, uid, initDb,
  getUser, getUserByEmail, createUser, updateUser, setUserPlan, setUserPlanByCustomerId,
  getDriversByOwner,
  getTrucks, getTruck, createTruck, updateTruck, deleteTruck,
  getLoads, getLoadsByOwner, createLoad, updateLoad, deleteLoad,
  getExpenses, getExpensesByOwner, createExpense, updateExpense, deleteExpense,
  getFuelLogs, createFuelLog, updateFuelLog, deleteFuelLog,
  getIftaSummary,
  getSettlements, getSettlementsByDriver, createSettlement, updateSettlementStatus,
  getDashboardTotals, getMonthlyLoads,
};
