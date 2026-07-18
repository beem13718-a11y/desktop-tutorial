const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Setup session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'garageflow-secret-key-12345',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Body parsing middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Global middleware to pass session user to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Middleware to check if user is authenticated (convenient export for fallback redirects)
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/auth/login');
};

// ==========================================
// IMPORT ROUTERS
// ==========================================
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerRoutes = require('./routes/customerRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const mechanicRoutes = require('./routes/mechanicRoutes');
const repairRoutes = require('./routes/repairRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const financeRoutes = require('./routes/financeRoutes');
const systemRoutes = require('./routes/systemRoutes');

const systemController = require('./controllers/systemController');

// ==========================================
// ROUTE MOUNTING
// ==========================================
app.post('/line/webhook', systemController.lineWebhook);
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/customers', customerRoutes);
app.use('/vehicles', vehicleRoutes);
app.use('/mechanics', mechanicRoutes);
app.use('/repairs', repairRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/finances', financeRoutes);
app.use('/settings', systemRoutes);

// Root redirects to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Redirect old reports route to unified finances page
app.get('/reports', isAuthenticated, (req, res) => {
  res.redirect('/finances');
});

// Alerts skeleton route (To avoid 404)
app.get('/notifications', isAuthenticated, (req, res) => {
  res.render('error', { 
    title: 'ประวัติการแจ้งเตือน', 
    message: 'หน้าระบบเก็บประวัติแจ้งเตือนกำลังอยู่ระหว่างพัฒนาเพิ่มเติม ขออภัยในความไม่สะดวก' 
  });
});

// Database connection check endpoint
app.get('/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 + 1 AS solution');
    res.json({ status: 'ok', message: 'Database connected successfully!', solution: rows[0].solution });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error: err.message });
  }
});

// Run database schema migrations on start
(async () => {
  try {
    await db.query(`
      ALTER TABLE finances 
      MODIFY COLUMN status ENUM('pending', 'paid', 'cancelled', 'installment') DEFAULT 'paid'
    `);
    console.log('[Migration] Table finances modified successfully to support installment status.');
  } catch (err) {
    console.error('[Migration Error] Failed to alter table finances:', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE finances 
      ADD COLUMN installment_terms VARCHAR(50) DEFAULT NULL
    `);
    console.log('[Migration] Column installment_terms added to table finances.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('[Migration Error] Failed to add column installment_terms:', err.message);
    }
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(100) UNIQUE NOT NULL,
        value TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_notify_token', '')");
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_channel_token', '')");
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_channel_secret', '')");
    console.log('[Migration] Table settings created and seeded.');
  } catch (err) {
    console.error('[Migration Error] Failed to create settings table:', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE customers 
      ADD COLUMN line_id VARCHAR(100) DEFAULT NULL
    `);
    console.log('[Migration] Column line_id added to table customers.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('[Migration Error] Failed to add column line_id to customers:', err.message);
    }
  }
})();

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` GarageFlow Server is running on port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
  console.log(`==================================================`);
});
