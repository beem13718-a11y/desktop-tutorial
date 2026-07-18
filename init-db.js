const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function initDb() {
  console.log('==================================================');
  console.log(' Starting Database Initialization for GarageFlow...');
  console.log('==================================================');

  // Load schema SQL file
  const schemaPath = path.join(__dirname, 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`[Error] Schema file not found at: ${schemaPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(schemaPath, 'utf8');

  // We connect to MySQL server without database first to create it
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    });
    console.log('[Connection] Connected to MySQL server successfully.');
  } catch (err) {
    console.error('[Error] Failed to connect to MySQL server. Is XAMPP MySQL running?');
    console.error('Details:', err.message);
    process.exit(1);
  }

  try {
    // Split SQL by semicolons, but ignore semicolons inside single/double quotes or block comments
    const statements = sqlContent
      .split(/;(?=(?:[^']*'[^']*')*[^']*$)/g) // split by semicolon outside quotes
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    console.log(`[Parse] Found ${statements.length} SQL statements to execute.`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      // Clean comments and whitespace
      const cleaned = statement
        .split('\n')
        .filter(line => !line.trim().startsWith('--') && !line.trim().startsWith('#'))
        .join('\n')
        .trim();

      if (cleaned) {
        // Show progress for creating database/tables
        if (cleaned.toUpperCase().startsWith('CREATE DATABASE')) {
          console.log('[Execute] Creating Database...');
        } else if (cleaned.toUpperCase().startsWith('USE')) {
          console.log('[Execute] Selecting Database...');
        } else if (cleaned.toUpperCase().startsWith('CREATE TABLE')) {
          const tableName = cleaned.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i)?.[1] || 'table';
          console.log(`[Execute] Creating Table: ${tableName}...`);
        } else if (cleaned.toUpperCase().startsWith('INSERT INTO')) {
          const tableName = cleaned.match(/INSERT INTO\s+`?(\w+)`?/i)?.[1] || 'table';
          console.log(`[Execute] Inserting Mock Data for ${tableName}...`);
        }
        
        await connection.query(cleaned);
      }
    }

    console.log('==================================================');
    console.log(' SUCCESS: Database configured and mock data loaded!');
    console.log('==================================================');
  } catch (err) {
    console.error('[Error] SQL execution failed:', err.message);
  } finally {
    await connection.end();
  }
}

initDb();
