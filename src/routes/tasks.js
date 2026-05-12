const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY status ASC, created_at DESC'
  ).all(req.session.user.id);
  res.render('tasks', { tasks, error: null });
});

router.post('/', (req, res) => {
  const { title, description, due_date } = req.body;
  if (!title || !title.trim()) return res.redirect('/tasks');
  const db = getDb();
  db.prepare(
    'INSERT INTO tasks (user_id, title, description, due_date) VALUES (?, ?, ?, ?)'
  ).run(req.session.user.id, title.trim(), description || null, due_date || null);
  res.redirect('/tasks');
});

router.post('/:id/update', (req, res) => {
  const { title, description, status, due_date } = req.body;
  const db = getDb();
  db.prepare(
    'UPDATE tasks SET title = ?, description = ?, status = ?, due_date = ? WHERE id = ? AND user_id = ?'
  ).run(
    title,
    description || null,
    status || 'pending',
    due_date || null,
    req.params.id,
    req.session.user.id
  );
  res.redirect('/tasks');
});

router.post('/:id/toggle', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT status FROM tasks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.session.user.id);
  if (task) {
    const next = task.status === 'done' ? 'pending' : 'done';
    db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?')
      .run(next, req.params.id, req.session.user.id);
  }
  res.redirect('/tasks');
});

router.post('/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);
  res.redirect('/tasks');
});

module.exports = router;
