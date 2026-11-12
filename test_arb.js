const fs=require('fs'),vm=require('vm'),mqtt=require('mqtt');
const S=n=>fs.readFileSync(n,'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function mkClient(){
  const els={};
  const mkEl=()=>({innerHTML:'',textContent:'',value:'',className:'',classList:{add(){},remove(){},contains(){return false}},focus(){},onclick:null,style:{},checked:false});
  const document={getElementById:id=>els[id]||(els[id]=mkEl())};
  const store={getItem:()=>null,setItem(){},removeItem(){}};
  const location={origin:'https://ls41.github.io',pathname:'/gzpoker/',search:'',host:'ls41.github.io',protocol:'https:'};
  const fetchShim=(u,o)=>fetch(new URL(u,location.origin+location.pathname).href,o);
  const ctx=vm.createContext({console,setTimeout,setInterval,clearTimeout,clearInterval,JSON,Math,Date,document,
    localStorage:store,location,navigator:{clipboard:null},URLSearchParams,URL,fetch:fetchShim,Promise,Error,String,Object,Array,Number,WebSocket:globalThis.WebSocket});
  ctx.window=ctx; ctx.globalThis=ctx; ctx.self=ctx; ctx.mqtt=mqtt;
  vm.runInContext(S('engine.js'),ctx); vm.runInContext(S('net.js'),ctx);
  vm.runInContext(S('bot.js'),ctx); vm.runInContext(S('app.js'),ctx);
  return {win:ctx,els};
}
(async()=>{
  const A=mkClient();
  A.els.createBots={checked:true}; A.els.createName={value:'A',focus(){}};
  A.els.doCreate.onclick();
  await sleep(2500);
  const room=A.win.__room();
  let st=A.win.__state();
  console.log('房间',room,'| host?',A.win.__isHost(),'| 座位',st.seats.map(s=>s.name).join(','));

  const pub=mqtt.connect('wss://broker.emqx.io:8084/mqtt',{clientId:'inj_'+Math.random().toString(16).slice(2,8)});
  await new Promise(r=>pub.on('connect',r));
  const topic='gzpoker/v1/'+room;

  // 分支1：对方只有 1 个座位 → 我应保持房主并合并
  pub.publish(topic, JSON.stringify({t:'state',from:'fakehost1',state:{host:'fakehost1',v:(st.v||0)+7,seats:[{pid:'fakehost1',name:'幽灵',ready:false,away:false}]}}));
  await sleep(1500);
  st=A.win.__state();
  console.log('分支1 合并 → host?',A.win.__isHost(),'| 座位',st.seats.map(s=>s.name).join(','));

  // 分支2：对方 6 个座位 → 我应让位并采纳
  const big=[...Array(6)].map((_,i)=>({pid:'h'+i,name:'大房间'+i,ready:true,away:false}));
  pub.publish(topic, JSON.stringify({t:'state',from:'fakehost2',state:{host:'fakehost2',v:(st.v||0)+9,seats:big}}));
  await sleep(1500);
  st=A.win.__state();
  console.log('分支2 让位 → host?',A.win.__isHost(),'| 座位',st.seats.map(s=>s.name).join(','));
  process.exit(0);
})();
