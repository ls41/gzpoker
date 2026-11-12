require('./engine.js'); require('./bot.js');
const WP = globalThis.WP;
let bad = 0, hands = 0, drinks = [], allin = 0;
for (let n = 3; n <= 10; n++) for (let h = 0; h < 300; h++) {
  const st = { seats: [], button: null, handNo: 0, log: [] };
  for (let i = 0; i < n; i++) st.seats.push({ pid: 'b' + i, name: 'B' + i });
  WP.startHand(st);
  let guard = 0;
  while (st.phase === 'bet' && guard++ < 300) {
    const k = WP.botAction(st);
    const r = WP.apply(st, st.seats[st.toAct].pid, k);
    if (!r.ok) { bad++; break; }
  }
  if (guard >= 300) bad++;
  if (st.phase !== 'result') bad++;
  if (st.result) { st.result.rows.forEach(x => drinks.push(x.cups)); if (st.seats.some(s => s.allin)) allin++; }
  hands++;
}
const avg = drinks.reduce((a, b) => a + b, 0) / drinks.length;
console.log('手数', hands, '异常', bad, '人均每手喝水', avg.toFixed(3), '杯',
  '| 全下局占比', (allin / hands * 100).toFixed(0) + '%',
  '| 单人最大', Math.max(...drinks).toFixed(2), '杯');
