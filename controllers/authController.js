const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Render Login Page
const showLogin = (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { title: 'เข้าสู่ระบบ', error: null, username: '' });
};

// Handle Login Authentication
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { title: 'เข้าสู่ระบบ', error: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน', username: username || '' });
  }

  try {
    console.log(`[Login Attempt] Username: "${username}", Password: "${password}"`);
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    console.log(`[Login DB Query] Rows returned: ${rows.length}`);
    
    if (rows.length === 0) {
      console.log(`[Login Fail] User "${username}" not found in database.`);
      return res.render('login', { title: 'เข้าสู่ระบบ', error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง', username: username });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    console.log(`[Login Bcrypt Match] Result: ${isMatch}`);
    
    if (!isMatch) {
      console.log(`[Login Fail] Password mismatch for user "${username}".`);
      return res.render('login', { title: 'เข้าสู่ระบบ', error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง', username: username });
    }

    // Check status
    if (user.status === 'inactive') {
      console.log(`[Login Fail] User "${username}" is inactive.`);
      return res.render('login', { title: 'เข้าสู่ระบบ', error: 'บัญชีผู้ใช้งานนี้ถูกระงับการใช้งานชั่วคราว', username: username });
    }

    // Set Session
    req.session.user = {
      id: user.id,
      username: user.username,
      fullname: user.fullname,
      role: user.role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login Error:', err);
    res.render('login', { title: 'เข้าสู่ระบบ', error: 'เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง', username: username });
  }
};

// Handle Logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout Session Destroy Error:', err);
    }
    res.redirect('/auth/login');
  });
};

module.exports = {
  showLogin,
  login,
  logout
};
