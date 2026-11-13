'use strict';
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'tb_session';
const SHORT_TTL = 12 * 60 * 60 * 1000; // 12 saat
const LONG_TTL = 30 * 24 * 60 * 60 * 1000; // 30 gün ("Beni Hatırla")

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    });
  return out;
}

function createSession(userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? LONG_TTL : SHORT_TTL;
  db.data.sessions[token] = { userId, expires: Date.now() + ttl };
  db.save();
  return { token, ttl };
}

function destroySession(token) {
  if (token && db.data.sessions[token]) {
    delete db.data.sessions[token];
    db.save();
  }
}

function destroyUserSessions(userId) {
  for (const [t, s] of Object.entries(db.data.sessions)) if (s.userId === userId) delete db.data.sessions[t];
  db.save();
}

function userFromToken(token) {
  const s = token && db.data.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) {
    delete db.data.sessions[token];
    db.save();
    return null;
  }
  const user = db.data.users.find((u) => u.id === s.userId);
  if (!user || user.blocked) return null;
  return user;
}

function cleanupSessions() {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of Object.entries(db.data.sessions)) {
    if (s.expires < now) {
      delete db.data.sessions[t];
      changed = true;
    }
  }
  if (changed) db.save();
}

function setCookie(res, token, ttl, remember) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${Math.floor(ttl / 1000)}`);
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Express ara katmanları
function attachUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.sessionToken = token;
  req.user = userFromToken(token);
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  next();
}

// Basit kaba kuvvet koruması
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.until < now) return false;
  return rec.count >= 8;
}
function recordFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.until < now) attempts.set(key, { count: 1, until: now + 10 * 60 * 1000 });
  else rec.count++;
}
function clearFailures(key) {
  attempts.delete(key);
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  parseCookies,
  createSession,
  destroySession,
  destroyUserSessions,
  userFromToken,
  cleanupSessions,
  setCookie,
  clearCookie,
  attachUser,
  requireUser,
  requireAdmin,
  tooManyAttempts,
  recordFailure,
  clearFailures,
};
