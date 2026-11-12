const fs = require('fs'), vm = require('vm'), mqtt = require('mqtt');
const S = n => fs.readFileSync(n, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mkClient() {
  const els = {};
  const mkEl = () => ({ innerHTML: '', textContent: '', value: '', className: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    focus() {}, onclick: null, style: {}, checked: false });
  const document = { getElementById: id => els[id] || (els[id] = mkEl()) };
  const store = { getItem: () => null, setItem() {}, removeItem() {} };
  const location = { origin: 'https://ls41.github.io', pathname: '/gzpoker/', search: '', host: 'ls41.github.io', protocol: 'https:' };
  const fetchShim = (u, o) => fetch(new URL(u, location.origin + location.pathname).href, o);
  const ctx = vm.createContext({ console, setTimeout, setInterval, clearTimeout, clearInterval,
    JSON, Math, Date, document, localStorage: store, location,
    navigator: { clipboard: null }, URLSearchParams, URL, fetch: fetchShim, Promise, Error, String, Object, Array, Number, WebSocket: globalThis.WebSocket, document: document });
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.mqtt = mqtt;
  vm.runInContext(S('engine.js'), ctx);
  vm.runInContext(S('net.js'), ctx);
  vm.runInContext(S('bot.js'), ctx);
  vm.runInContext(S('app.js'), ctx);
  return { win: ctx, els };
}
(async () => {
  const room = String(5000 + Math.floor(Math.random() * 900));
  console.log('房间', room);
  const B = mkClient();                       // 先加入（房间里还没人）
  B.els.joinName = { value: 'B', focus() {} }; B.els.joinCode = { value: room, focus() {} };
  B.els.doJoinRoom.onclick();

  await sleep(400);
  const A = mkClient();                       // 随后建房
  A.els.createBots = { checked: true };
  A.els.createName = { value: 'A', focus() {} };
  A.els.doCreate.onclick();

  await sleep(6000);
  const sa = A.win.__state(), sb = B.win.__state();
  console.log('A host?', A.win.__isHost(), '| B host?', B.win.__isHost());
  console.log('A 座位:', sa ? sa.seats.map(s => s.name).join(',') : '无');
  console.log('B 座位:', sb ? sb.seats.map(s => s.name).join(',') : '无');
  process.exit(0);
})();
