// Load .env into process.env before anything else
const fs   = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) process.env[k] = v.join('=');
  });
}

const http       = require('http');
const statsHandler  = require('./netlify/functions/stats').handler;
const authHandler   = require('./netlify/functions/auth').handler;
const searchHandler = require('./netlify/functions/search').handler;

const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

function buildEvent(req, body) {
  return {
    httpMethod: req.method,
    headers:    req.headers,
    body,
    queryStringParameters: {},
  };
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ── Netlify functions ──────────────────────────────────────────────────
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
      const body    = await readBody(req);
      const qs      = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const event   = { ...buildEvent(req, body), queryStringParameters: qs };
      const handler = url.endsWith('/auth') ? authHandler : url.endsWith('/search') ? searchHandler : statsHandler;
      const result  = await handler(event);

      res.writeHead(result.statusCode, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        ...result.headers,
      });
      res.end(result.body || '');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static files ───────────────────────────────────────────────────────
  let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });

}).listen(PORT, () => {
  console.log(`Dashboard → http://localhost:${PORT}`);
});
