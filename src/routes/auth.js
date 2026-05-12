const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/tasks');
  res.render('login', { error: null });
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/tasks');
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4) {
    return res.status(400).render('register', {
      error: 'Username and password (min 4 chars) are required'
    });
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).render('register', { error: 'Username already taken' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  req.session.user = { id: info.lastInsertRowid, username };
  res.redirect('/tasks');
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).render('login', { error: 'Username and password required' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/tasks');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
