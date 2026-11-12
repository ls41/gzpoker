const fs = require('fs'), vm = require('vm');
const engineSrc = fs.readFileSync('engine.js', 'utf8');
const appSrc = fs.readFileSync('app.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const clients = [];
function makeClient(idx, name) {
  const els = {};
  const mkEl = () => ({ classList: { add() {}, remove() {}, contains() { return false; } },
    innerHTML: '', textContent: '', value: '', focus() {}, onclick: null, style: {} });
  const document = { getElementById(id) { return els[id] || (els[id] = mkEl()); }, };
  const store = {};
  const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v) };
  const location = { search: '?room=t' + Date.now(), origin: 'http://x', pathname: '/i.html', reload() {} };
  const win = {};
  const ctx = vm.createContext({
    window: win, document, localStorage, location,
    navigator: { clipboard: { writeText() {} } },
    setInterval, setTimeout, clearTimeout, console, URLSearchParams, Date, Math, JSON, Object, Array, Number, String, Boolean
  });
  win.mqtt = {}; 
  win.createNet = opt => {
    const c = { opt, send(m) { setTimeout(() => clients.forEach(o => setTimeout(() => { try { o.cb(JSON.parse(JSON.stringify(m))); } catch (e) {} }, 1)), 1); } };
    setTimeout(() => { opt.onStatus && opt.onStatus('on'); opt.onConnect && opt.onConnect(); }, 1);
    clients.push({ cb: m => opt.onMsg(m), id: name });
    return c;
  };
  vm.runInContext(engineSrc, ctx);
  vm.runInContext(appSrc, ctx);
  return { name, ctx, els, win };
}
const P = [makeClient(0, '阿强'), makeClient(1, '小美'), makeClient(2, '老王')];
P.forEach((p, i) => setTimeout(() => {
  p.els.nameInput.value = p.name;
  p.els.joinBtn.onclick();
}, 120 * i));

(async () => {
  await sleep(4200);
  const host = P.find(p => p.win.__isHost());
  console.log('房主:', host && host.name);
  let st = host.win.__state();
  console.log('房间人数:', st.seats.length, '阶段:', st.phase);

  P.forEach(p => p.win.WPUI.ready());
  await sleep(1500);
  st = host.win.__state();
  console.log('准备后阶段:', st.phase, '手数:', st.handNo);

  let acted = 0, guard = 0;
  while (guard++ < 40) {
    const s = host.win.__state();
    if (s.phase === 'result' || !s.game) break;
    const g = s.game;
    if (g.phase !== 'bet') { await sleep(200); continue; }
    const pid = g.seats[g.toAct].pid;
    const pl = P.find(p => p.win.__state() && p.win.__state().seats.find(x => x.pid === pid));
    const target = P.find(p => p.name === g.seats[g.toAct].name);
    const L = host.win.WP.legal(g);
    const pick = L.find(a => a.k === 'call') || L.find(a => a.k === 'check') || L.find(a => a.k === 'fold');
    target.win.WPUI.act(pick.k);
    acted++;
    await sleep(80);
  }
  st = host.win.__state();
  console.log('动作数:', acted, '阶段:', st.phase, '底池:', st.game && st.game.pot, '公牌:', (st.game.board || []).map(c => host.win.WP.cstr(c)).join(' '));
  if (st.game.result) {
    console.log('结算:', st.game.result.rows.map(r => `${r.name}:投入${r.units}份→${r.won ? '不喝' : r.cups + '杯'}`).join(' | '));
    console.log('累计喝水:', Object.entries(st.drinks).map(([k, v]) => k + '=' + v.toFixed(3)).join(' '));
  }
  // 下一手：按钮应轮动
  const btnBefore = st.button;
  P.find(p => p.win.__isHost()).win.WPUI.next();
  await sleep(600);
  st = host.win.__state();
  console.log('下一手按钮:', btnBefore, '→', st.button, '手数:', st.handNo);
  process.exit(0);
})();
