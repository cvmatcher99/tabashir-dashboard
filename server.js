// ── Tabashir Dashboard — Production Server ──────────────────────────────
// Works on Railway, Render, or any Node.js host

// Load .env if present (local dev only — on Railway use env vars in dashboard)
const fs   = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) process.env[k] = v.join('=');
  });
}

const http = require('http');

// ── Import function handlers ────────────────────────────────────────────
const statsHandler  = require('./netlify/functions/stats').handler;
const authHandler   = require('./netlify/functions/auth').handler;
const searchHandler = require('./netlify/functions/search').handler;

// ── Railway provides PORT env var ───────────────────────────────────────
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

function buildEvent(req, body, qs) {
  return {
    httpMethod: req.method,
    headers:    req.headers,
    body,
    queryStringParameters: qs || {},
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const url = parsedUrl.pathname;

  // ── API Routes (emulate Netlify functions) ────────────────────────────
  if (url === '/.netlify/functions/stats' || url === '/.netlify/functions/auth' || url === '/.netlify/functions/search') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    try {
      const body  = await readBody(req);
      const qs    = Object.fromEntries(parsedUrl.searchParams);
      const event = buildEvent(req, body, qs);

      let handler;
      if (url.endsWith('/auth'))   handler = authHandler;
      else if (url.endsWith('/search')) handler = searchHandler;
      else handler = statsHandler;

      const result = await handler(event);

      res.writeHead(result.statusCode, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        ...result.headers,
      });
      res.end(result.body || '');
    } catch (e) {
      console.error('API error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────
  let filePath;
  if (url === '/' || url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (url === '/login.html') {
    filePath = path.join(__dirname, 'login.html');
  } else {
    filePath = path.join(__dirname, url);
  }

  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // If file not found, redirect to index
      if (url !== '/favicon.ico') {
        res.writeHead(302, { Location: '/' });
        res.end();
      } else {
        res.writeHead(404);
        res.end('');
      }
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tabashir Dashboard running on port ${PORT}`);
});
