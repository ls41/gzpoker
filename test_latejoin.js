const fs=require('fs'), vm=require('vm');
const S=n=>fs.readFileSync(n,'utf8'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clients=[];
function mk(name, search){
  const els={}, mkEl=()=>({classList:{add(){},remove(){},contains(){return false}},innerHTML:'',textContent:'',value:'',focus(){},onclick:null,style:{}});
  const document={getElementById:id=>els[id]||(els[id]=mkEl())};
  const store={}; const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)};
  const location={search,origin:'http://x',pathname:'/i.html',reload(){}};
  const win={};
  const ctx=vm.createContext({window:win,document,localStorage,location,navigator:{clipboard:{writeText(){}}},setInterval,setTimeout,clearTimeout,console,URLSearchParams,Date,Math,JSON,Object,Array,Number,String,Boolean,parseInt});
  win.createNet=opt=>{const c={send(m){setTimeout(()=>clients.forEach(o=>setTimeout(()=>{try{o.cb(JSON.parse(JSON.stringify(m)))}catch(e){}},1)),1)}};
    setTimeout(()=>{opt.onStatus&&opt.onStatus('on');opt.onConnect&&opt.onConnect()},1);
    clients.push({cb:m=>opt.onMsg(m)});return c;};
  vm.runInContext(S('engine.js'),ctx); vm.runInContext(S('bot.js'),ctx); vm.runInContext(S('app.js'),ctx);
  return {name,ctx,win,els};
}
const me = mk('我', '?room=late' + Date.now() + '&bots=3');
(async()=>{
  await sleep(3200);
  let st = me.win.__state();
  console.log('建房后: host=', me.win.__isHost(), '座位:', st ? st.seats.map(s=>s.name).join(',') : 'null');
  // 现在才填名字
  me.els.nameInput.value = '我';
  me.els.joinBtn.onclick();
  await sleep(600);
  st = me.win.__state();
  console.log('入座后座位:', st.seats.map(s=>s.name+(s.bot?'(bot)':'')).join(', '), '| phase:', st.phase);
  me.win.WPUI.ready();
  await sleep(1200);
  st = me.win.__state();
  console.log('准备后 phase:', st.phase, '手数:', st.handNo);
  let guard=0;
  while (guard++<300) {
    st = me.win.__state();
    if (st.phase==='result') break;
    const g=st.game;
    if (g&&g.phase==='bet'&&g.toAct>=0) {
      const myPid = st.seats.find(s=>s.name==='我').pid;
      if (g.seats[g.toAct].pid===myPid) {
        const L=me.win.WP.legal(g);
        me.win.WPUI.act((L.find(a=>a.k==='call')||L.find(a=>a.k==='check')||L.find(a=>a.k==='fold')).k);
        await sleep(150); continue;
      }
    }
    await sleep(200);
  }
  st = me.win.__state();
  console.log('打完后 phase:', st.phase, '| 结算:', st.game.result ? st.game.result.rows.map(r=>`${r.name}${r.won?'🏆':''}:${r.cups?r.cups+'杯':'不喝'}`).join(' | ') : '无');
  process.exit(0);
})();
