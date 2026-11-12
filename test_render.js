const fs=require('fs'), vm=require('vm');
const S=n=>fs.readFileSync(n,'utf8'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clients=[];
function mk(search){
  const els={}, mkEl=()=>{const o={innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},contains(){return false}},focus(){},onclick:null,style:{}};return o;};
  const document={getElementById:id=>els[id]||(els[id]=mkEl())};
  const store={}; const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)};
  const location={search,origin:'http://x',pathname:'/i.html',reload(){}};
  const win={};
  const ctx=vm.createContext({window:win,document,localStorage,location,navigator:{clipboard:{writeText(){}}},setInterval,setTimeout,clearTimeout,console,URLSearchParams,Date,Math,JSON,Object,Array,Number,String,Boolean,parseInt});
  win.createNet=opt=>{const c={send(m){setTimeout(()=>clients.forEach(o=>setTimeout(()=>{try{o.cb(JSON.parse(JSON.stringify(m)))}catch(e){}},1)),1)}};
    setTimeout(()=>{opt.onStatus&&opt.onStatus('on');opt.onConnect&&opt.onConnect()},1);
    clients.push({cb:m=>opt.onMsg(m)});return c;};
  vm.runInContext(S('engine.js'),ctx); vm.runInContext(S('bot.js'),ctx); vm.runInContext(S('app.js'),ctx);
  return {ctx,win,els};
}
const me = mk('?room=rd' + Date.now() + '&bots=3');
setTimeout(()=>{ me.els.nameInput.value='我'; me.els.joinBtn.onclick(); }, 100);
(async()=>{
  await sleep(3300);
  me.win.WPUI.ready();
  await sleep(1200);
  let st = me.win.__state();
  console.log('phase', st.phase);
  console.log('座位HTML:', me.els.opps.innerHTML.replace(/></g,'>\n<').split('\n').filter(l=>l.includes('hn')).join(' '));
  console.log('我的区(亮):', me.els.me.innerHTML.slice(0,220));
  me.win.WPUI.peek();
  console.log('点按后(藏):', me.els.me.innerHTML.slice(0,120));
  me.win.WPUI.peek();
  let g=0;
  while (g++<300) {
    st = me.win.__state();
    if (st.phase==='result') break;
    const gg=st.game;
    if (gg&&gg.phase==='bet'&&gg.toAct>=0) {
      const myPid = st.seats.find(s=>s.name==='我').pid;
      if (gg.seats[gg.toAct].pid===myPid) {
        const L=me.win.WP.legal(gg);
        me.win.WPUI.act((L.find(a=>a.k==='call')||L.find(a=>a.k==='check')||L.find(a=>a.k==='fold')).k);
        await sleep(150); continue;
      }
    }
    await sleep(180);
  }
  console.log('\n结算面板:\n' + me.els.result.innerHTML.replace(/<\/(div)>/g,'</div>\n'));
  process.exit(0);
})();
