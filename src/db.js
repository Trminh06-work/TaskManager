const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db;

function getDb() {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function initDb() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

module.exports = { getDb, initDb };
