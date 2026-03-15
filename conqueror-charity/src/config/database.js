const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './conqueror.db';
let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(path.resolve(DB_PATH), (err) => {
      if (err) { console.error('Failed to open database:', err.message); process.exit(1); }
      console.log('SQLite connected to ' + DB_PATH);
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

function dbRun(sql, params) {
  params = params || [];
  return new Promise(function(resolve, reject) {
    getDb().run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params) {
  params = params || [];
  return new Promise(function(resolve, reject) {
    getDb().get(sql, params, function(err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params) {
  params = params || [];
  return new Promise(function(resolve, reject) {
    getDb().all(sql, params, function(err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { getDb, dbRun, dbGet, dbAll };
