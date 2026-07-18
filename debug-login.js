const db = require('./config/db');
const bcrypt = require('bcryptjs');

async function debug() {
  console.log('--- DEBUGGING LOGIN DATABASE ---');
  try {
    const [rows] = await db.query('SELECT * FROM users');
    console.log('Total users in DB:', rows.length);
    rows.forEach(u => {
      console.log(`Username: "${u.username}", Role: "${u.role}", Status: "${u.status}", Hash: "${u.password}"`);
    });
    
    // Test comparison again
    if (rows.length > 0) {
      const match = await bcrypt.compare('owner123', rows[0].password);
      console.log(`Match check for ${rows[0].username} with "owner123":`, match);
    }
  } catch (err) {
    console.error('Error querying DB:', err.message);
  } finally {
    process.exit(0);
  }
}

debug();
