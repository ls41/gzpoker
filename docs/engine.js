/* 三张德州·喝水版 规则引擎（浏览器/Node 通用）
 * 单位: 每人每手 8 份 = 1 纸杯; 盲注 1/2; 下注 1; 抬注 +1; 每人每街最多抬 1 次
 * 结算: 输家喝自己投入; 弃牌喝一半; 赢家不喝
 */
(function (root) {
  'use strict';
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const CATS = ['高牌', '一对', '同花', '顺子', '三条', '同花顺'];
  const CFG = { UNITS: 8, SB: 1, BB: 2, BET: 1, RAISE: 1, FOLD_PENALTY: 0.5, MIN_DRINK: 1, STREETS: 3 };

  const cstr = c => RANKS[c >> 2] + SUITS[c & 3];
  const rk = c => c >> 2, st = c => c & 3;

  function eval3(a, b, c) {
    const rs = [rk(a), rk(b), rk(c)].sort((x, y) => y - x);
    const flush = (st(a) === st(b) && st(b) === st(c));
    const uniq = new Set(rs).size;
    let straight = false, hi = 0;
    if (uniq === 3) {
      if (rs[0] - rs[2] === 2) { straight = true; hi = rs[0]; }
      else if (rs[0] === 12 && rs[1] === 1 && rs[2] === 0) { straight = true; hi = 1; }
    }
    if (flush && straight) return { cat: 5, tie: [hi] };
    if (uniq === 1) return { cat: 4, tie: [rs[0]] };
    if (straight) return { cat: 3, tie: [hi] };
    if (flush) return { cat: 2, tie: rs.slice() };
    if (uniq === 2) {
      const p = rs[0] === rs[1] ? rs[0] : rs[2];
      const k = rs[0] === rs[1] ? rs[2] : rs[0];
      return { cat: 1, tie: [p, k] };
    }
    return { cat: 0, tie: rs.slice() };
  }

  function cmp(a, b) {
    if (a.cat !== b.cat) return a.cat - b.cat;
    for (let i = 0; i < Math.min(a.tie.length, b.tie.length); i++)
      if (a.tie[i] !== b.tie[i]) return a.tie[i] - b.tie[i];
    return 0;
  }

  function best3(cards) {
    let best = null, bc = null;
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++)
        for (let k = j + 1; k < cards.length; k++) {
          const e = eval3(cards[i], cards[j], cards[k]);
          if (!best || cmp(e, best) > 0) { best = e; bc = [cards[i], cards[j], cards[k]]; }
        }
    return { ev: best, cards: bc };
  }

  function shuffled() {
    const d = []; for (let i = 0; i < 52; i++) d.push(i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  function newSeat(p, idx) {
    return { pid: p.pid, name: p.name, seat: idx, inn: 0, bet: 0, stack: CFG.UNITS,
             folded: false, allin: false, raised: false, acted: false, hole: [], won: false };
  }

  function log(st, m) { st.log.push(m); if (st.log.length > 80) st.log.shift(); }

  function post(st, i, amt, label) {
    const s = st.seats[i], pay = Math.min(amt, s.stack);
    s.stack -= pay; s.bet += pay; s.inn += pay; st.pot += pay;
    if (s.stack === 0) s.allin = true;
    log(st, s.name + ' 下' + label + ' ' + pay + ' 份');
  }

  function startHand(st) {
    const n = st.seats.length;
    st.handNo = (st.handNo || 0) + 1;
    st.button = (st.button == null ? 0 : (st.button + 1) % n);
    st.phase = 'bet'; st.street = 0; st.board = []; st.pot = 0; st.result = null; st.log = [];
    const deck = shuffled();
    st.seats = st.seats.map((s, i) => newSeat(s, i));
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < n; i++) st.seats[(st.button + 1 + i) % n].hole.push(deck.pop());
    st.deck = deck;
    const sbIdx = n === 2 ? st.button : (st.button + 1) % n;
    const bbIdx = (sbIdx + 1) % n;
    post(st, sbIdx, CFG.SB, '小盲');
    post(st, bbIdx, CFG.BB, '大盲');
    st.cur = CFG.BB; st.toAct = (bbIdx + 1) % n; st.lastAgg = bbIdx;
    log(st, '第 ' + st.handNo + ' 手 · 按钮 ' + st.seats[st.button].name + ' · 每人 ' + CFG.UNITS + ' 份 = 1 杯');
    return st;
  }

  const alive = st => st.seats.filter(s => !s.folded);

  function legal(st) {
    const s = st.seats[st.toAct];
    if (!s) return [];
    const need = Math.max(0, st.cur - s.bet);
    const out = [{ k: 'fold' }];
    if (need === 0) out.push({ k: 'check' });
    else out.push({ k: 'call', cost: Math.min(need, s.stack) });
    if (!s.raised && s.stack > need) out.push({ k: need === 0 ? 'bet' : 'raise', to: st.cur + (st.cur === 0 ? CFG.BET : CFG.RAISE) });
    if (s.stack > 0) out.push({ k: 'allin', cost: s.stack });
    return out;
  }

  function apply(st, pid, kind) {
    if (st.phase !== 'bet') return { ok: false, err: '不在下注阶段' };
    const i = st.toAct, s = st.seats[i];
    if (!s || s.pid !== pid) return { ok: false, err: '还没轮到你' };
    if (!legal(st).some(a => a.k === kind)) return { ok: false, err: '非法动作' };
    const need = Math.max(0, st.cur - s.bet);

    if (kind === 'fold') { s.folded = true; s.acted = true; log(st, s.name + ' 弃牌（已投 ' + s.inn + ' 份）'); }
    else if (kind === 'check') { s.acted = true; log(st, s.name + ' 过牌'); }
    else if (kind === 'call') {
      const pay = Math.min(need, s.stack);
      s.stack -= pay; s.bet += pay; s.inn += pay; st.pot += pay; s.acted = true;
      if (s.stack === 0) s.allin = true;
      log(st, s.name + ' 跟注 ' + pay + ' 份' + (s.allin ? '（全下）' : ''));
    } else if (kind === 'bet' || kind === 'raise') {
      const target = st.cur + (st.cur === 0 ? CFG.BET : CFG.RAISE);
      const pay = Math.min(target - s.bet, s.stack);
      s.stack -= pay; s.bet += pay; s.inn += pay; st.pot += pay;
      s.raised = true; s.acted = true; st.cur = s.bet; st.lastAgg = i;
      if (s.stack === 0) s.allin = true;
      st.seats.forEach(x => { if (!x.folded && x !== s) x.acted = false; });
      log(st, s.name + ' ' + (kind === 'bet' ? '下注' : '抬注') + '到 ' + s.bet + ' 份' + (s.allin ? '（全下）' : ''));
    } else if (kind === 'allin') {
      const pay = s.stack;
      s.stack = 0; s.bet += pay; s.inn += pay; st.pot += pay; s.allin = true;
      if (s.bet > st.cur) { s.raised = true; st.cur = s.bet; st.lastAgg = i;
        st.seats.forEach(x => { if (!x.folded && x !== s) x.acted = false; }); }
      s.acted = true;
      log(st, s.name + ' 全下 ' + s.inn + ' 份');
    }
    step(st);
    return { ok: true };
  }

  function streetDone(st) {
    const act = st.seats.filter(s => !s.folded && !s.allin);
    if (!act.length) return true;
    return act.every(s => s.bet === st.cur && s.acted);
  }

  function nextPos(st, from) {
    const n = st.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n, s = st.seats[i];
      if (!s.folded && !s.allin) return i;
    }
    return -1;
  }

  function step(st) {
    if (alive(st).length <= 1) return endHand(st);
    const canAct = st.seats.filter(s => !s.folded && !s.allin);
    if (canAct.length === 0) {            // 全部全下，无人可行动
      if (st.street >= CFG.STREETS) return showdown(st);
      return runOut(st);
    }
    if (streetDone(st)) return endStreet(st);
    let i = st.toAct;
    for (let g = 0; g < 60; g++) {
      i = (i + 1) % st.seats.length;
      const s = st.seats[i];
      if (!s.folded && !s.allin && (s.bet < st.cur || !s.acted)) { st.toAct = i; return; }
    }
    return endStreet(st);
  }

  function endStreet(st) {
    if (alive(st).length <= 1) return endHand(st);
    if (st.street >= CFG.STREETS) return showdown(st);
    const canBet = st.seats.filter(s => !s.folded && !s.allin).length;
    if (canBet <= 1) return runOut(st);
    st.street++;
    st.board.push(st.deck.pop());
    log(st, '—— 公牌 ' + st.street + '：' + cstr(st.board[st.board.length - 1]) + ' ——');
    st.seats.forEach(s => { s.bet = 0; s.raised = false; s.acted = false; });
    st.cur = 0; st.lastAgg = -1;
    st.toAct = nextPos(st, st.button);
    if (st.toAct < 0) return endHand(st);
  }

  function runOut(st) {
    while (st.board.length < CFG.STREETS) {
      st.board.push(st.deck.pop()); st.street = st.board.length;
      log(st, '—— 公牌 ' + st.street + '：' + cstr(st.board[st.board.length - 1]) + ' ——');
    }
    showdown(st);
  }

  function showdown(st) {
    st.phase = 'showdown'; st.toAct = -1;
    const A = st.seats.filter(s => !s.folded);
    A.forEach(s => {
      const r = best3(s.hole.concat(st.board));
      s.ev = r.ev; s.best = r.cards; s.handName = CATS[r.ev.cat];
    });
    let best = null; A.forEach(s => { if (!best || cmp(s.ev, best) > 0) best = s.ev; });
    const W = A.filter(s => cmp(s.ev, best) === 0);
    W.forEach(w => w.won = true);
    log(st, '摊牌：' + W.map(w => w.name).join('、') + ' 赢（' + CATS[best.cat] + '）');
    settle(st, W);
  }

  function endHand(st) {
    const A = st.seats.filter(s => !s.folded);
    A.forEach(s => { s.won = true; s.handName = '无人跟注'; });
    st.phase = 'showdown'; st.toAct = -1;
    log(st, A.map(s => s.name).join('、') + ' 直接收池');
    settle(st, A);
  }

  function settle(st, winners) {
    const wset = new Set(winners.map(w => w.pid));
    st.result = { winners: winners.map(w => w.pid), rows: [] };
    st.seats.forEach(s => {
      let units = 0;
      if (!wset.has(s.pid)) {
        units = s.inn * (s.folded ? CFG.FOLD_PENALTY : 1);
        units = Math.max(units, CFG.MIN_DRINK);   // 非赢家最低 1 份 = 1/8 杯
      }
      const cups = Math.min(units, CFG.UNITS) / CFG.UNITS;
      s.drink = cups;
      st.result.rows.push({ pid: s.pid, name: s.name, units, cups, folded: s.folded, won: wset.has(s.pid) });
      if (cups > 0) log(st, s.name + ' 喝 ' + units + ' 份 = ' + fmt(cups));
    });
    st.phase = 'result';
  }

  function fmt(cups) {
    const e = Math.round(cups * 8);
    if (e === 0) return '0 杯';
    const w = Math.floor(e / 8), r = e % 8;
    if (!r) return w + ' 杯';
    return (w ? w + ' ' : '') + r + '/8 杯';
  }

  root.WP = { CFG, cstr, eval3, best3, cmp, startHand, legal, apply, fmt, CATS, RANKS, SUITS };
})(typeof window !== 'undefined' ? window : globalThis);
