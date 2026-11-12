/* 简易机器人：按当前牌力 + 听牌潜力 + 价格决策 */
(function (root) {
  const WP = root.WP;
  WP.botAction = function (g) {
    const i = g.toAct, s = g.seats[i];
    if (!s) return 'fold';
    const need = Math.max(0, g.cur - s.bet);
    const L = WP.legal(g);
    const has = k => L.some(a => a.k === k);
    let v;
    if (s.hole.length + g.board.length < 3) {
      // 翻前：只看两张底牌
      const r1 = s.hole[0] >> 2, r2 = s.hole[1] >> 2;
      v = (Math.max(r1, r2) / 12) * 6;
      if (r1 === r2) v += 12;
      if ((s.hole[0] & 3) === (s.hole[1] & 3)) v += 4;
      if (Math.abs(r1 - r2) <= 2) v += 3;
    } else {
      const best = WP.best3(s.hole.concat(g.board));
      v = best.ev.cat * 10 + ((best.ev.tie[0] || 0) / 13) * 5;
    }

    // 早期听牌价值：同花 / 连张
    const unshown = 3 - g.board.length;
    if (unshown > 0) {
      const suit = {};
      s.hole.forEach(c => { suit[c & 3] = (suit[c & 3] || 0) + 1; });
      if (Object.values(suit).some(x => x >= 2)) v += 2.5 * unshown / 3;
      const r1 = s.hole[0] >> 2, r2 = s.hole[1] >> 2;
      if (Math.abs(r1 - r2) <= 2) v += 2 * unshown / 3;
    }
    const r = Math.random();
    const cheap = need <= 2;

    if (need === 0) {
      if (has('bet') && (v >= 30 || (v >= 18 && r < 0.55) || r < 0.18)) return 'bet';
      return has('check') ? 'check' : 'call';
    }
    if (v >= 30) return has('raise') ? 'raise' : 'call';
    if (v >= 18) { if (has('raise') && r < 0.32) return 'raise'; return has('call') ? 'call' : 'fold'; }
    if (v >= 8) { if (cheap || r < 0.35) return has('call') ? 'call' : 'fold'; return 'fold'; }
    if (cheap && r < 0.45 && has('call')) return 'call';
    return 'fold';
  };
})(typeof window !== "undefined" ? window : globalThis);
