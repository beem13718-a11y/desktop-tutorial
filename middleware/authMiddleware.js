// Authentication and Role-based Access Control Middlewares

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/auth/login');
};

const isOwner = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'owner') {
    return next();
  }
  // If not owner, send unauthorized or redirect with error
  res.status(403).render('error', { 
    title: 'ปฏิเสธการเข้าถึง', 
    message: 'บทบาทของคุณไม่มีสิทธิ์ในการใช้งานฟังก์ชันนี้ (เฉพาะเจ้าของอู่เท่านั้น)' 
  });
};

module.exports = {
  isAuthenticated,
  isOwner
};
