const { Client } = require('pg');
const jwt        = require('jsonwebtoken');

const DB = {
  host:     '77.243.85.225',
  port:     5432,
  database: 'tabashir',
  user:     'postgres',
  password: 'tabashir2025',
  ssl:      false,
  connectionTimeoutMillis: 8000,
};

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const auth  = (event.headers && event.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const email = ((event.queryStringParameters || {}).email || '').trim();
  if (!email || email.length < 2) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Email query too short' }) };
  }
  if (email.length > 120) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Query too long' }) };
  }

  const client = new Client(DB);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT id, name, email, phone_number, nationality, gender, date_in
       FROM clients
       WHERE LOWER(email) LIKE LOWER($1)
       ORDER BY date_in DESC, id DESC
       LIMIT 30`,
      ['%' + email + '%']
    );
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ results: result.rows, total: result.rowCount }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end().catch(() => {});
  }
};
