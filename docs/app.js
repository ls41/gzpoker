(function () {
  if (!window.WP || typeof window.createNet !== 'function') {
    document.body.innerHTML = '<div style="padding:28px;color:#fff;font:15px/1.9 -apple-system,sans-serif;background:#0f3d2e;height:100vh">'
      + '<b style="color:#e8c072">脚本加载不完整</b><br>请完全关闭页面后重新打开：<br>'
      + '<span style="color:#8fe0b0">http://192.168.31.216:8010</span><br><br>'
      + '<span style="color:#8fa79c;font-size:13px">如果反复出现：浏览器菜单 → 设置 → 清除缓存，或换用系统浏览器（Chrome/Safari）打开。</span></div>';
    return;
  }
  'use strict';
  const WP = window.WP;
  const P = new URLSearchParams(location.search);
  let ROOM = '';
  let TOPIC = '';
  const BROKER = P.get('broker') || localStorage.getItem('wp_broker') || 'wss://broker.emqx.io:8084/mqtt';
  const TURN_MS = 60000;
  const VER = 'v23';

  let pid = (typeof P !== 'undefined' && P.get('pid')) || localStorage.getItem('wp_pid');
  if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 9); localStorage.setItem('wp_pid', pid); }
  let myName = localStorage.getItem('wp_name') || '';

  let state = null, isHost = false, hostState = null, lastStateAt = 0, wantBots = 0;
  let seen = {}, nextTimer = null, turnStamp = 0, peek = true;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- 传输 ---------------- */
  let net = null;
  function boot() {
    net = window.createNet({
      room: ROOM, topic: TOPIC, mqttUrl: BROKER,
      allowMQTT: P.get('net') === 'mqtt',
      onStatus: (st, kind) => {
        const d = $('conn'); if (d) d.className = 'dot' + (st === 'on' ? ' on' : st === 'error' ? ' err' : '');
        const tx = $('netTxt');
        if (tx) tx.textContent = st === 'on'
          ? ('已连接·' + (kind === 'http' ? '兼容' : kind === 'mqtt' ? 'MQTT' : '局域网'))
          : (kind === 'http' ? '兼容模式连接中…' : '连接中…');
      },
      onConnect: () => { sendJoin(); },
      onMsg: onMsg
    });
    sendJoin();
    setInterval(() => {
      net.send({ t: 'ping', pid, name: myName });
      checkHost();
      if (!state || !state.seats.some(s => s.pid === pid)) sendJoin();
      if (isHost) { prune(); send({ t: 'state', from: pid, state: hostState }); }
    }, 3000);
    setInterval(tick, 500);
    render();
  }

  function send(m) { if (net) net.send(m); }
  let _joinAt = 0;
  function sendJoin() {
    if (!myName) return;
    if (Date.now() - _joinAt < 1500) return;
    _joinAt = Date.now();
    send({ t: 'join', pid, name: myName });
  }

  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.pid) seen[m.pid] = Date.now();
    if (m.from) seen[m.from] = Date.now();

    if (m.t === 'state') {
      if (m.from === pid) return;                 // 自己的广播忽略
      // 双房主仲裁：pid 小的当房主；pid 大的让位并采纳对方状态，绝不"互不理睬"
      const oh = m.state.host;
      if (isHost && oh && oh !== pid) {
        const otherN = (m.state.seats || []).length, mineN = hostState.seats.length;
        // 座位多者胜；相同则 pid 小者胜
        const otherWins =
          otherN > mineN || (otherN === mineN && String(oh) < String(pid));
        if (otherWins) {
          isHost = false; hostState = null;
        } else {
          // 我继续当房主，但把对方的人并进来，避免丢人
          (m.state.seats || []).forEach(x => {
            if (!hostState.seats.some(y => y.pid === x.pid)) hJoin(x.pid, x.name);
          });
          return;
        }
      }
      if (!state || (m.state.v | 0) >= (state.v | 0)) {
        state = m.state; lastStateAt = Date.now();
          render();
      }
      return;
    }
    if (m.pid === pid) return;
    if (m.t === 'join') { if (isHost) hJoin(m.pid, m.name); return; }
    if (m.t === 'ready') { if (isHost) hReady(m.pid); return; }
    if (m.t === 'act') { if (isHost) hAct(m.pid, m.k); return; }
    if (m.t === 'next') { if (isHost) hNext(); return; }
  }

  /* ---------------- 房主逻辑 ---------------- */
  function blank() {
    return { v: 1, host: pid, phase: 'lobby', seats: [], button: -1, handNo: 0,
             drinks: {}, game: null, log: ['创建房间'], turn: null, turnAt: 0 };
  }
  function becomeHost(seed) {
    isHost = true;
    hostState = seed ? JSON.parse(JSON.stringify(seed)) : blank();
    hostState.host = pid; hostState.v = (hostState.v | 0) + 1;
    if (!hostState.seats.some(s => s.pid === pid) && myName)
      hostState.seats.push({ pid, name: myName, ready: false, away: false });
    const nb = wantBots || parseInt(P.get('bots') || '0', 10);
    if (nb > 0 && hostState.seats.length <= 1) { wantBots = 0; hAddBot(Math.min(nb, 9)); }
    bump();
  }
  function hAddBot(n) {
    if (!isHost) return;
    for (let i = 0; i < n; i++) {
      if (hostState.seats.length >= 10) break;
      let k = 1; while (hostState.seats.some(s => s.pid === 'bot' + k)) k++;
      hostState.seats.push({ pid: 'bot' + k, name: '机器人' + k, ready: true, away: false, bot: true });
      hlog('机器人' + k + ' 入座');
    }
    bump(); maybeStart();
  }
  function botTurn() {
    if (!isHost || hostState.phase !== 'bet') return;
    const g = hostState.game;
    if (!g || g.phase !== 'bet' || g.toAct < 0) return;
    const seat = g.seats[g.toAct];
    const meta = hostState.seats.find(x => x.pid === seat.pid);
    if (!meta || !meta.bot) return;
    const stamp = hostState.turnSeq;
    setTimeout(() => {
      if (!isHost || !hostState.game || hostState.phase !== 'bet') return;
      if (hostState.turnSeq !== stamp) return;
      const gg = hostState.game;
      if (gg.phase !== 'bet' || gg.toAct < 0 || gg.seats[gg.toAct].pid !== seat.pid) return;
      const k = WP.botAction(gg);
      hAct(seat.pid, k);
    }, 650 + Math.random() * 900);
  }

  function bump() {
    if (!isHost) return;
    hostState.v = (hostState.v | 0) + 1;
    hostState.log = hostState.log.slice(-60);
    state = hostState; lastStateAt = Date.now();
    send({ t: 'state', from: pid, state: hostState });
    render();
  }
  function hlog(s) { hostState.log.push(s); if (hostState.log.length > 60) hostState.log.shift(); }
  function hJoin(p, name) {
    const s = hostState.seats.find(x => x.pid === p);
    if (s) { if (name && s.name !== name) { s.name = name; bump(); } return; }
    if (hostState.seats.length >= 10) return;
    hostState.seats.push({ pid: p, name: name || '玩家', ready: false, away: false });
    hlog((name || '玩家') + ' 入座');
    bump(); maybeStart();
  }
  function hReady(p) {
    const s = hostState.seats.find(x => x.pid === p); if (!s) return;
    if (hostState.phase !== 'lobby' && hostState.phase !== 'result') { s.ready = true; return bump(); }
    s.ready = !s.ready; bump(); maybeStart();
  }
  function maybeStart() {
    if (hostState.phase !== 'lobby') return;
    const live = hostState.seats.filter(s => !s.away);
    if (!live.some(s => !s.bot)) return;                       // 全是机器人不开局
    if (live.length >= 3 && hostState.seats.length === live.length && live.every(s => s.ready)) hStart();
  }
  function hStart() {
    const live = hostState.seats.filter(s => !s.away);
    if (!live.some(s => !s.bot)) { hostState.phase = 'lobby'; return bump(); }
    if (live.length < 3) { hlog('人数不足 3 人，回到准备界面'); hostState.phase = 'lobby'; return bump(); }
    hostState.seats = live;
    hostState.game = { seats: live.map(s => ({ pid: s.pid, name: s.name })),
                       button: hostState.button, handNo: hostState.handNo, log: [] };
    WP.startHand(hostState.game);
    hostState.button = hostState.game.button;
    hostState.handNo = hostState.game.handNo;
    hostState.phase = 'bet';
    hostState.settled = false;
    hostState.turn = hostState.game.toAct >= 0 ? hostState.game.seats[hostState.game.toAct].pid : null;
    hostState.turnAt = Date.now();
    hostState.turnSeq = (hostState.turnSeq || 0) + 1;
    botTurn();
    hostState.seats.forEach(s => s.ready = true);
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    bump();
  }
  function hAct(p, k) {
    if (hostState.phase !== 'bet') return;
    const g = hostState.game;
    if (!g || g.phase !== 'bet') return;
    const r = WP.apply(g, p, k);
    if (!r.ok) return;
    afterAction();
  }
  function afterAction() {
    const g = hostState.game;
    if (g.phase === 'result') {
      if (!hostState.settled) {
        hostState.settled = true;
        g.result.rows.forEach(r => {
          hostState.drinks[r.pid] = (hostState.drinks[r.pid] || 0) + r.cups;
        });
      }
      hostState.phase = 'result';
      hostState.turn = null;
      if (nextTimer) clearTimeout(nextTimer);
      nextTimer = setTimeout(() => { nextTimer = null; if (hostState.phase === 'result') hStart(); }, 12000);
    } else {
      hostState.phase = 'bet';
      hostState.turn = g.toAct >= 0 ? g.seats[g.toAct].pid : null;
      hostState.turnAt = Date.now();
      hostState.turnSeq = (hostState.turnSeq || 0) + 1;
      botTurn();
    }
    bump();
  }
  function hNext() {
    if (hostState.phase !== 'result') return;
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    hStart();
  }
  function prune() {
    if (!isHost) return;
    if (hostState.phase !== 'lobby' && hostState.phase !== 'result') return;
    const now = Date.now();
    const before = hostState.seats.length;
    hostState.seats = hostState.seats.filter(s => s.bot || s.pid === pid || (seen[s.pid] || 0) > now - 25000);
    if (hostState.seats.length !== before) { hlog('有人掉线，已移出座位'); if (hostState.seats.length < 3) hostState.phase = 'lobby'; }
    if (hostState.seats.length < 3) hostState.phase = 'lobby';
  }

  function hFoldTimeout() {
    if (!isHost || hostState.phase !== 'bet') return;
    const g = hostState.game;
    if (!g || g.phase !== 'bet') return;
    const s = g.seats[g.toAct];
    if (!s) return;
    const L = WP.legal(g);
    const k = L.some(a => a.k === 'check') ? 'check' : 'fold';
    hlog(s.name + ' 超时自动' + (k === 'check' ? '过牌' : '弃牌'));
    hActByForce(s.pid, k);
  }
  function hActByForce(p, k) {
    const r = WP.apply(hostState.game, p, k);
    if (r.ok) afterAction();
  }

  /* ---------------- 故障转移 ---------------- */
  function checkHost() {
    if (isHost) return;
    if (!state) { if (!lastStateAt && myName) { /* 无人建房：等 3 秒后自建 */ } return; }
    const quiet = Date.now() - lastStateAt;
    if (quiet < 9000) return;
    const alive = state.seats.filter(s => !s.bot && (s.pid === pid || (seen[s.pid] || 0) > Date.now() - 15000));
    if (!alive.length) return;
    if (alive[0].pid === pid) { becomeHost(state); }
  }

  /* ---------------- 渲染 ---------------- */
  const SUIT_CLS = ['', 'red', 'red', ''];
  function cardHTML(c, mini, extra, style) {
    const st = style ? ' style="' + style + '"' : '';
    if (c == null || c < 0) return '<div class="card back' + (mini ? '' : '') + (extra || '') + '"' + st + '></div>';
    const r = WP.RANKS[c >> 2], su = WP.SUITS[c & 3];
    return '<div class="card' + (SUIT_CLS[c & 3] ? ' ' + SUIT_CLS[c & 3] : '') + (extra || '') + '"' + st +
      '><b>' + r + '</b><span>' + su + '</span></div>';
  }
  let prevBoard = [], prevHole = '';
  function fmtCup(c) { return WP.fmt(c || 0); }
  function curHand(cards) {
    if (!cards || cards.length < 3) return '';
    try { return WP.CATS[WP.best3(cards).ev.cat]; } catch (e) { return ''; }
  }
  function curHandInfo(cards) {
    if (!cards || cards.length < 3) return null;
    try {
      const r = WP.best3(cards);
      return { name: WP.CATS[r.ev.cat], cards: r.cards, txt: r.cards.map(c => WP.cstr(c)).join(' ') };
    } catch (e) { return null; }
  }

  function render() {
    try { renderInner(); } catch (e) { console.warn(e); }
  }
  function renderInner() {
    if (!state.drinks) state.drinks = {};
    if (!state.log) state.log = [];
    $('roomTag').textContent = ROOM ? ('房间 ' + ROOM) : '房间 —';
    if (!state) return;
    const seats = state.seats || [];
    const g = state.game;
    const inHand = g && (state.phase === 'bet' || state.phase === 'result');
    const myIdx = seats.findIndex(s => s.pid === pid);

    // 座位
    let html = '';
    const reveal = state.phase === 'result';
    const headPid = (inHand && g.seats[g.button]) ? g.seats[g.button].pid : null;
    const others = seats.filter(s => s.pid !== pid);
    const k = others.length;
    others.forEach((s, i) => {
      const gs = inHand ? g.seats.find(x => x.pid === s.pid) : null;
      const acting = inHand && g.phase === 'bet' && g.seats[g.toAct] && g.seats[g.toAct].pid === s.pid;
      const folded = gs && gs.folded;
      const isHead = headPid === s.pid;
      // 环绕公牌：对手沿上半椭圆分布，各自贴边
      const th = Math.PI * (1 + (i + 0.5) / Math.max(k, 1));
      let x = 50 + 44 * Math.cos(th), y = 50 + 41 * Math.sin(th);
      x = Math.max(12, Math.min(88, x)); y = Math.max(12, Math.min(84, y));
      let mini = '';
      if (gs) {
        const show = reveal && !gs.folded;
        mini = '<div class="mini">' + gs.hole.map(c => cardHTML(show ? c : -1, true)).join('') + '</div>';
      }
      const stTxt = !gs ? (s.ready ? '已准备' : '未准备')
        : gs.folded ? '弃牌' : gs.allin ? '全下' : ('剩 ' + gs.stack);
      const hn = (gs && reveal && !gs.folded) ? curHand(gs.hole.concat(g.board)) : '';
      html += '<div class="seat' + (acting ? ' acting' : '') + (isHead ? ' head' : '') + (folded ? ' folded' : '') +
        '" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%">' +
        '<div class="row1"><span class="nm">' + (s.bot ? '🤖 ' : '') + esc(s.name) + '</span>' +
        (acting ? '<span class="turnMark">▶</span>' : '') +
        (isHead ? '<span class="mark">头</span>' : '') + '</div>' + mini +
        (hn ? '<div class="hn">' + hn + '</div>' : '') +
        '<div class="st">' + (gs && gs.inn ? '投' + gs.inn + ' · ' : '') + stTxt + '</div>' +
        '<div class="st">💧' + fmtCup(state.drinks[s.pid]) + '</div></div>';
    });
    $('opps').innerHTML = html || '<div class="hint">还没有其他玩家，把链接发给朋友</div>';

    // 公牌
    let bh = '';
    const newFrom = prevBoard.length;
    for (let i = 0; i < 3; i++) {
      const c = inHand && g.board && g.board[i];
      const fresh = c != null && prevBoard[i] === undefined;
      bh += (c == null) ? '<div class="card empty"></div>'
        : cardHTML(c, false, fresh ? ' flip' : '',
            fresh ? 'animation-delay:' + ((i - newFrom) * 0.22).toFixed(2) + 's' : '');
    }
    $('board').innerHTML = bh;
    const potEl = $('pot');
    const ptxt = inHand ? ('底池 ' + g.pot + ' 份' + (state.phase === 'result' ? ' · 本手结束' : '')) : '等待开局';
    if (potEl.textContent !== ptxt) {
      potEl.textContent = ptxt;
      potEl.classList.remove('bump'); void potEl.offsetWidth; potEl.classList.add('bump');
    }

    // 自己
    const gsMe = inHand ? g.seats.find(x => x.pid === pid) : null;
    const myInfo = (gsMe && peek) ? curHandInfo(gsMe.hole.concat(g.board)) : null;
    const isMyHead = headPid === pid;
    $('me').className = 'me' + (isMyHead ? ' head' : '');
    const holeKey = gsMe ? gsMe.hole.join(',') : '';
    const holeNew = holeKey && holeKey !== prevHole;
    $('me').innerHTML = gsMe
      ? '<div class="cards" onclick="WPUI.peek()" title="点按显示/隐藏">' +
          gsMe.hole.map((c, i) => cardHTML(peek ? c : -1, false,
            holeNew && peek ? ' new' : '',
            holeNew && peek ? 'animation-delay:' + (i * 0.13).toFixed(2) + 's' : '')).join('') + '</div>' +
        '<div class="lbl">' + esc(gsMe.name) + (isMyHead ? ' <span class="mark">头</span>' : '') +
        (myInfo ? ' · <span class="hn" style="font-size:13px">' + myInfo.name +
          '</span> <span style="font-size:11px;color:#9db8ac">' + myInfo.txt + '</span>' : '') +
        '<br>已投 ' + gsMe.inn + ' 份' +
        (gsMe.folded ? ' · 已弃牌' : gsMe.allin ? ' · 全下' : '') +
        '<br><span style="font-size:10px;opacity:.6">点牌面隐藏/显示</span></div>'
      : (myIdx >= 0 ? '<div class="lbl">' + esc(seats[myIdx].name) + '<br>💧 ' + fmtCup(state.drinks[pid]) + '</div>' : '');

    prevBoard = inHand && g.board ? g.board.slice() : [];
    prevHole = gsMe ? gsMe.hole.join(',') : '';

    // 操作
    const acts = [];
    if (!myName) acts.push('<button class="g" onclick="WPUI.showHome()">入座</button>');
    else if (myIdx < 0) acts.push('<button class="ghost" disabled>等待入座…</button>');
    else if (state.phase === 'lobby') {
      const s = seats[myIdx];
      acts.push('<button class="' + (s.ready ? 'ghost' : 'g') + '" onclick="WPUI.ready()">' + (s.ready ? '取消准备' : '准备') + '</button>');
      if (isHost) acts.push('<button class="p" onclick="WPUI.addBot()">+ 机器人</button>');
      if (isHost) acts.push('<button class="p" onclick="WPUI.forceStart()">强制开局(≥3人)</button>');
      acts.push('<button class="ghost" onclick="WPUI.invite()">复制邀请</button>');
    } else if (state.phase === 'bet' && g.phase === 'bet') {
      const turnPid = g.seats[g.toAct] && g.seats[g.toAct].pid;
      if (turnPid === pid) {
        const need = Math.max(0, g.cur - gsMe.bet);
        WP.legal(g).forEach(a => {
          if (a.k === 'fold') acts.push('<button class="r" onclick="WPUI.act(\'fold\')">弃牌</button>');
          if (a.k === 'check') acts.push('<button class="p" onclick="WPUI.act(\'check\')">过牌</button>');
          if (a.k === 'call') acts.push('<button class="p" onclick="WPUI.act(\'call\')">跟注 ' + a.cost + '</button>');
          if (a.k === 'bet') acts.push('<button class="g" onclick="WPUI.act(\'bet\')">下注 ' + WP.CFG.BET + '</button>');
          if (a.k === 'raise') acts.push('<button class="g" onclick="WPUI.act(\'raise\')">抬注到 ' + a.to + '</button>');
          if (a.k === 'allin') acts.push('<button class="r" onclick="WPUI.act(\'allin\')">全下 ' + gsMe.stack + '</button>');
        });
      } else {
        const who = g.seats[g.toAct] ? g.seats[g.toAct].name : '—';
        acts.push('<button class="ghost" disabled>等待 ' + esc(who) + ' 行动</button>');
      }
    } else if (state.phase === 'result') {
      acts.push('<button class="p" onclick="WPUI.next()">下一手</button>');
      if (isHost) acts.push('<button class="ghost" onclick="WPUI.forceStart()">立即开始</button>');
    }
    $('actions').innerHTML = acts.join('');

    // 提示
    let hint = '';
    if (state.phase === 'bet' && g.phase === 'bet' && state.turnAt) {
      const left = Math.max(0, TURN_MS - (Date.now() - state.turnAt));
      hint = '本手第 ' + g.handNo + ' 手 · 拖到 ' + Math.ceil(left / 1000) + ' 秒自动行动';
    } else if (state.phase === 'lobby') hint = '至少 3 人，全部准备后自动开局（最多 10 人）';
    else if (state.phase === 'result') hint = '本手结束，12 秒后自动开下一手';
    if (state.phase !== 'lobby' && myIdx >= 0 && g && !g.seats.some(x => x.pid === pid))
      hint = '本手进行中，下一手自动入座';
    $('hint').textContent = hint;

    // 榜单
    const rows = seats.map(s => ({ n: s.name, c: state.drinks[s.pid] || 0, me: s.pid === pid }))
      .sort((a, b) => b.c - a.c);
    $('scores').innerHTML = rows.map(r =>
      '<div class="row"><span>' + esc(r.n) + (r.me ? ' <span class="tag">我</span>' : '') +
      '</span><span class="r2">' + fmtCup(r.c) + '</span></div>').join('') || '<div class="row">—</div>';

    // 日志
    const lg = (g && g.log ? g.log : state.log) || [];
    $('log').innerHTML = lg.slice(-14).reverse().map(x => '<div>' + esc(x) + '</div>').join('');

    // 结算（内联，不弹窗）
    if (state.phase === 'result' && g.result) {
      const rows = g.result.rows.slice().sort((a, b) =>
        (b.won - a.won) || (b.cups - a.cups));
      $('result').innerHTML =
        '<div class="rrow win" style="justify-content:center;font-weight:800;color:#ffd479">本手结算</div>' +
        rows.map(r => {
          const gs = g.seats.find(x => x.pid === r.pid) || {};
          const info = curHandInfo((gs.hole || []).concat(g.board));
          let hn = gs.handName || (info ? info.name : '');
          let hc = info ? info.txt : '';
          if (r.folded) { hn = '弃牌'; hc = ''; }
          return '<div class="rrow' + (r.won ? ' win' : '') + '">' +
            '<span class="rn">' + (r.won ? '🏆 ' : '') + esc(r.name) +
            (r.folded ? ' <span class="tag">弃</span>' : '') + '</span>' +
            '<span class="rh">' + (hn || '—') + (hc ? ' ' + hc : '') + ' · ' + r.units + '份</span>' +
            '<span class="rd">' + (r.cups ? '喝 ' + fmtCup(r.cups) : '不喝') + '</span></div>';
        }).join('');
    } else if ($('result').innerHTML) $('result').innerHTML = '';
  }

  function tick() {
    if (isHost && hostState && hostState.phase === 'bet' && hostState.game && hostState.game.phase === 'bet') {
      if (Date.now() - hostState.turnAt > TURN_MS) hFoldTimeout();
    }
    // 刷新倒计时文本
    if (state) {
      const el = $('hint');
      if (state.phase === 'bet' && state.turnAt) {
        const left = Math.max(0, TURN_MS - (Date.now() - state.turnAt));
        el.textContent = '第 ' + state.game.handNo + ' 手 · ' + Math.ceil(left / 1000) + ' 秒后自动行动';
      }
    }
  }

  /* ---------------- 对外接口 ---------------- */
  window.__state = () => state;
  window.__room = () => ROOM;
  window.__isHost = () => isHost;

  window.WPUI = {
    ready() { isHost ? hReady(pid) : send({ t: 'ready', pid }); },
    act(k) { isHost ? hAct(pid, k) : send({ t: 'act', pid, k }); },
    next() { isHost ? hNext() : send({ t: 'next', pid }); },
    forceStart() { if (isHost) hStart(); },
    addBot(n) { if (isHost) hAddBot(n || 1); },
    peek() { peek = !peek; render(); },
    showHome() { showPane('join'); },
    copyLink() {
      const txt = '官庄POKER 房间号 ' + ROOM + ' → ' + dirText();
      try { if (navigator.clipboard) navigator.clipboard.writeText(txt); } catch (e) {}
      $('hint').textContent = '已复制：' + txt;
    },
    invite() {
      const url = location.origin + location.pathname + '?room=' + encodeURIComponent(ROOM);
      navigator.clipboard && navigator.clipboard.writeText(url);
      $('hint').textContent = '邀请链接已复制：' + url;
    },
    setBroker(u) { localStorage.setItem('wp_broker', u); location.reload(); }
  };

  /* ---------------- 启动 ---------------- */
  myName = localStorage.getItem('wp_name') || '';
  const home = $('home'), homeHint = $('homeHint');
  const PANES = { pick: 'pickPane', create: 'createPane', join: 'joinPane' };
  function genCode() { return String(1000 + Math.floor(Math.random() * 9000)); }

  function showPane(which) {
    home.classList.remove('hidden');
    Object.keys(PANES).forEach(k => { $(PANES[k]).style.display = (k === which ? 'block' : 'none'); });
    homeHint.textContent = '';
    if (which === 'create') { $('createName').value = myName || ''; setTimeout(() => $('createName').focus(), 120); }
    if (which === 'join') { $('joinName').value = myName || ''; setTimeout(() => $('joinName').focus(), 120); }
  }
  function takeName(id) {
    const v = ($(id).value || '').trim().slice(0, 8);
    if (!v) { $(id).focus(); homeHint.textContent = '先给自己起个名字'; return null; }
    myName = v; localStorage.setItem('wp_name', v); return v;
  }
  function dirText() { return location.origin + location.pathname; }

  function startRoom(code, fast) {
    home.classList.add('hidden');
    ROOM = code; TOPIC = 'gzpoker/v1/' + ROOM;
    log_('进入房间 ' + ROOM);
    boot();
    doJoin(myName, fast);
  }
  function log_(m) { try { console.log('[官庄POKER]', m); } catch (e) {} }

  function doJoin(v, fast) {
    myName = v;
    if (isHost) hJoin(pid, myName); else sendJoin();
    setTimeout(() => {
      if (!state) { becomeHost(null); return; }
      if (!state.seats.some(s => s.pid === pid)) {
        if (state.host === pid) { isHost = true; hostState = state; hJoin(pid, myName); }
        else sendJoin();
      }
    }, fast ? 1200 : 4000);
  }

  $('goCreate').onclick = () => showPane('create');
  $('goJoin').onclick = () => showPane('join');
  $('backFromCreate').onclick = () => showPane('pick');
  $('backFromJoin').onclick = () => showPane('pick');

  $('doCreate').onclick = () => {
    if (!takeName('createName')) return;
    wantBots = $('createBots').checked ? 3 : 0;
    startRoom(genCode(), true);
  };
  $('doJoinRoom').onclick = () => {
    if (!takeName('joinName')) return;
    const c = String($('joinCode').value || '').replace(/\D/g, '').slice(0, 4);
    if (c.length !== 4) { homeHint.textContent = '请输入 4 位数字房间号'; $('joinCode').focus(); return; }
    startRoom(c, false);
  };
  $('createName').onkeydown = e => { if (e.key === 'Enter') $('doCreate').click(); };
  $('joinName').onkeydown = e => { if (e.key === 'Enter') $('joinCode').focus(); };
  $('joinCode').onkeydown = e => { if (e.key === 'Enter') $('doJoinRoom').click(); };

  const vt = $('verTag'); if (vt) vt.textContent = '版本 ' + VER;
  const _nb = $('nextBtn'); if (_nb) _nb.onclick = () => window.WPUI.next();
  const _ib = $('inviteBtn'); if (_ib) _ib.onclick = () => window.WPUI.copyLink();
  showPane('pick');
})();
