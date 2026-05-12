const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use(requireAuth);

router.get('/tasks', (req, res) => {
  const db = getDb();
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.session.user.id);
  res.json(tasks);
});

router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
});

router.post('/tasks', (req, res) => {
  const { title, description, due_date, status } = req.body;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO tasks (user_id, title, description, status, due_date) VALUES (?, ?, ?, ?, ?)'
  ).run(
    req.session.user.id,
    String(title).trim(),
    description || null,
    status || 'pending',
    due_date || null
  );
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(task);
});

router.put('/tasks/:id', (req, res) => {
  const { title, description, status, due_date } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'UPDATE tasks SET title = ?, description = ?, status = ?, due_date = ? WHERE id = ?'
  ).run(
    title ?? existing.title,
    description ?? existing.description,
    status ?? existing.status,
    due_date ?? existing.due_date,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

module.exports = router;
