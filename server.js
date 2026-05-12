const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDb } = require('./src/db');
const metrics = require('./src/metrics');
const authRoutes = require('./src/routes/auth');
const taskRoutes = require('./src/routes/tasks');
const apiRoutes = require('./src/routes/api');

function createApp() {
  initDb();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
  });

  metrics.register(app);

  app.use('/', authRoutes);
  app.use('/tasks', taskRoutes);
  app.use('/api', apiRoutes);

  app.get('/', (req, res) => {
    res.redirect(req.session.user ? '/tasks' : '/login');
  });

  app.use((req, res) => res.status(404).send('Not found'));

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = { createApp };
