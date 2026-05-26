const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 min
const attempts     = {};             // in-memory (resets on cold start)

exports.handler = async (event) => {
  const cors = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Rate limiting (per IP) ─────────────────────────────────────────────
  const ip  = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
  const now = Date.now();
  if (!attempts[ip] || now - attempts[ip].start > WINDOW_MS) {
    attempts[ip] = { count: 0, start: now };
  }
  attempts[ip].count++;
  if (attempts[ip].count > MAX_ATTEMPTS) {
    await delay(2000);
    return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Too many attempts. Try again later.' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { password } = body;
  if (!password || typeof password !== 'string' || password.length > 128) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Password required' }) };
  }

  // ── Verify password ───────────────────────────────────────────────────
  const hash   = process.env.DASH_PASSWORD_HASH;
  const secret = process.env.JWT_SECRET;

  if (!hash || !secret) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    await delay(1200); // timing-safe delay
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  // ── Issue JWT ─────────────────────────────────────────────────────────
  attempts[ip].count = 0; // reset on success
  const token = jwt.sign({ iss: 'tabashir-dash', v: 1 }, secret, {
    expiresIn: '10h',
    algorithm: 'HS256',
  });

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ token }),
  };
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
