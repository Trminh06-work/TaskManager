function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
}

module.exports = { requireAuth };
