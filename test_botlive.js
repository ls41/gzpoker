const fs=require('fs'), vm=require('vm');
const S = n => fs.readFileSync(n,'utf8');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const clients=[];
function mk(name, search){
  const els={}, mkEl=()=>({classList:{add(){},remove(){},contains(){return false}},innerHTML:'',textContent:'',value:'',focus(){},onclick:null,style:{}});
  const document={getElementById:id=>els[id]||(els[id]=mkEl())};
  const store={}; const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)};
  const location={search,origin:'http://x',pathname:'/i.html',reload(){}};
  const win={};
  const ctx=vm.createContext({window:win,document,localStorage,location,navigator:{clipboard:{writeText(){}}},setInterval,setTimeout,clearTimeout,console,URLSearchParams,Date,Math,JSON,Object,Array,Number,String,Boolean,parseInt});
  win.createNet=opt=>{ const c={send(m){setTimeout(()=>clients.forEach(o=>setTimeout(()=>{try{o.cb(JSON.parse(JSON.stringify(m)))}catch(e){}},1)),1)}};
    setTimeout(()=>{opt.onStatus&&opt.onStatus('on');opt.onConnect&&opt.onConnect()},1);
    clients.push({cb:m=>opt.onMsg(m),id:name}); return c; };
  vm.runInContext(S('engine.js'),ctx); vm.runInContext(S('bot.js'),ctx); vm.runInContext(S('app.js'),ctx);
  return {name,ctx,win,els};
}
const me = mk('我', '?room=bt' + Date.now() + '&bots=3');
setTimeout(()=>{ me.els.nameInput.value='我'; me.els.joinBtn.onclick(); }, 100);

(async()=>{
  await sleep(3500);
  let st = me.win.__state();
  console.log('房主:', me.win.__isHost(), '座位:', st.seats.map(s=>s.name+(s.bot?'(bot)':'')).join(', '));
  me.win.WPUI.ready();
  await sleep(1500);
  st = me.win.__state();
  console.log('阶段:', st.phase, '手数:', st.handNo, '公牌位:', (st.game?st.game.board.length:0));

  let myActs=0, guard=0;
  while (guard++ < 400) {
    st = me.win.__state();
    if (st.phase === 'result') break;
    const g = st.game;
    if (g && g.phase==='bet' && g.toAct>=0) {
      const pidNow = g.seats[g.toAct].pid;
      const myPid = st.seats.find(s=>s.name==='我').pid;
      if (pidNow === myPid) {
        const L = me.win.WP.legal(g);
        const pick = L.find(a=>a.k==='call')||L.find(a=>a.k==='check')||L.find(a=>a.k==='fold');
        me.win.WPUI.act(pick.k); myActs++;
        await sleep(120); continue;
      }
    }
    await sleep(200);
  }
  st = me.win.__state();
  console.log('我的动作数:', myActs, '| 阶段:', st.phase, '| 公牌:', (st.game.board||[]).map(c=>me.win.WP.cstr(c)).join(' '));
  console.log('结算:', st.game.result.rows.map(r=>`${r.name}${r.won?'🏆':''}:${r.units}份→${r.cups?r.cups+'杯':'不喝'}`).join(' | '));
  me.win.WPUI.next();
  await sleep(900);
  const st2 = me.win.__state();
  console.log('下一手:', st2.handNo, '按钮:', st2.button, '(上一手', st.button, ')');
  process.exit(0);
})();
