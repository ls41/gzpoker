/* 官庄POKER · 静态服务 + 房间中继（WebSocket + HTTP 长轮询，共用同一房间表） */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8010;
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* ---------- 房间表：WS 与 HTTP 轮询共用 ---------- */
const rooms = new Map();          // room -> Set<sink(msg)>
const polls = new Map();          // cid -> {room, queue:[], res, at}
function roomSet(r) { if (!rooms.has(r)) rooms.set(r, new Set()); return rooms.get(r); }
function joinRoom(room, sink) { const s = roomSet(room); s.add(sink); return () => s.delete(sink); }
function broadcast(room, msg, except) {
  for (const sink of roomSet(room)) { if (sink === except) continue; try { sink(msg); } catch (e) {} }
  for (const p of polls.values()) {
    if (p.room !== room || p.cid === except) continue;
    if (p.res) { try { p.res.end(JSON.stringify([msg])); } catch (e) {} p.res = null; }
    else if (p.queue.length < 200) p.queue.push(msg);
  }
}
function countRoom(r) {
  let n = roomSet(r).size;
  for (const p of polls.values()) if (p.room === r && p.res) n++;
  return n;
}

/* ---------- HTTP ---------- */
const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');

  if (u.pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end('{"ok":1,"srv":"gzpoker"}');
  }

  if (u.pathname === '/api/poll') {
    const room = String(u.query.room || ''), cid = String(u.query.cid || '');
    let p = polls.get(cid);
    if (!p) { p = { cid, room, queue: [], res: null, at: Date.now() }; polls.set(cid, p); }
    p.room = room; p.at = Date.now();
    if (p.queue.length) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(p.queue.splice(0))); }
    p.res = res;
    if (!p.timer) p.timer = setInterval(() => {
      if (p.res) { try { p.res.end('[]'); } catch (e) {} p.res = null; }
    }, 15000);
    req.on('close', () => { if (p.res === res) p.res = null; });
    return;
  }

  if (u.pathname === '/api/msg' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      let m; try { m = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad'); }
      const room = String(u.query.room || m.room || '');
      if (m.t === 'join') console.log('[http-join] 房间=' + room + ' 名称=' + (m.name || '?') + ' ip=' + ip);
      broadcast(room, m, null);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}');
    });
    return;
  }

  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    console.log('[http] ' + ip + ' ' + p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(buf);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const room = String((url.parse(req.url, true).query.room) || '');
  console.log('[+] WS 连接 房间=' + room + ' ip=' + ip);
  const sink = m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  let off = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.t === 'sub') {
      if (off) off();
      off = joinRoom(String(m.room || room), sink);
      m.room = String(m.room || room);
      console.log('[sub] 房间=' + m.room + ' 在线=' + countRoom(m.room));
      sink(m);
      return;
    }
    if (m.t === 'join') console.log('[join] 房间=' + room + ' 名称=' + (m.name || '?') + ' ip=' + ip);
    m.room = room;
    sink(m);                 // 回显给房主自己（前端靠 pid 过滤）
    broadcast(room, m, sink);
  });
  ws.on('close', () => { if (off) off(); console.log('[-] WS 断开 房间=' + room + ' 剩余=' + countRoom(room)); });
  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('官庄POKER 已启动: http://0.0.0.0:' + PORT + '  (WS /ws + HTTP /api/poll)');
});
