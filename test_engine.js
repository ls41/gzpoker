require('./engine.js');
const WP = globalThis.WP;
let bad = [];
let hands = 0, actions = 0, showdowns = 0, allins = 0, folds = 0, maxInn = 0;
for (let n = 3; n <= 10; n++) {
  for (let h = 0; h < 800; h++) {
    const st = { seats: [], button: null, handNo: 0, log: [] };
    for (let i = 0; i < n; i++) st.seats.push({ pid: 'p' + i, name: 'P' + i });
    WP.startHand(st);
    let guard = 0;
    while (st.phase === 'bet' && guard++ < 400) {
      const i = st.toAct;
      const s = st.seats[i];
      if (!s || s.pid !== st.seats[i].pid) { bad.push([n, 'toAct 无效']); break; }
      const L = WP.legal(st);
      // 随机策略：50% 跟/过，30% 抬，20% 弃（但免费过牌时不过弃）
      let pick;
      const r = Math.random();
      const canFree = L.some(a => a.k === 'check');
      if (r < 0.18 && !canFree) pick = L.find(a => a.k === 'fold');
      else if (r < 0.45) pick = L.find(a => a.k === 'raise') || L.find(a => a.k === 'bet') || L.find(a => a.k === 'call') || L[0];
      else pick = L.find(a => a.k === 'check') || L.find(a => a.k === 'call') || L[0];
      const res = WP.apply(st, s.pid, pick.k);
      if (!res.ok) { bad.push([n, 'apply失败', res.err]); break; }
      actions++;
    }
    if (guard >= 400) bad.push([n, '未终止']);
    hands++;
    const sumInn = st.seats.reduce((a, s) => a + s.inn, 0);
    if (sumInn !== st.pot) bad.push([n, '底池不等于投入', sumInn, st.pot]);
    st.seats.forEach(s => {
      maxInn = Math.max(maxInn, s.inn);
      if (s.inn > 8) bad.push([n, '投入超上限', s.inn]);
      if (s.folded && s.won) bad.push([n, '弃牌者获胜']);
      if (s.drink != null && s.drink > 1) bad.push([n, '喝水超1杯', s.drink]);
    });
    if (st.phase !== 'result') bad.push([n, '未结算', st.phase]);
    if (st.seats.filter(s => !s.folded).length > 1 && st.board.length !== 3) bad.push([n, '摊牌公牌数错误', st.board.length]);
    if (st.board.length > 3) bad.push([n, '公牌过多', st.board.length]);
    if (st.result && st.result.winners.length) {
      const anyAll = st.seats.some(s => s.allin);
      if (anyAll) allins++;
      if (st.seats.filter(s => !s.folded).length > 1) showdowns++;
    }
    folds += st.seats.filter(s => s.folded).length;
  }
}
console.log('手数', hands, '动作', actions, '均动作/手', (actions / hands).toFixed(1),
  '全下局', allins, '摊牌局', showdowns, '最大单人投入', maxInn, '平均弃牌人数', (folds / hands).toFixed(2));
console.log('异常', bad.length, bad.slice(0, 5));
