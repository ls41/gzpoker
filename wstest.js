function connectPkt(cid) {
  const name = Buffer.from('MQTT');
  const id = Buffer.from(cid);
  const vh = Buffer.concat([Buffer.from([0,4]), name, Buffer.from([4,2,0,60])]);
  const pl = Buffer.concat([Buffer.from([id.length>>8, id.length&255]), id]);
  const body = Buffer.concat([vh, pl]);
  return Buffer.concat([Buffer.from([0x10, body.length]), body]);
}
async function probe(url) {
  return new Promise(res => {
    const ws = new WebSocket(url, 'mqtt');
    const t = setTimeout(() => { try{ws.close()}catch(e){}; res(url+' TIMEOUT'); }, 8000);
    ws.onopen = () => ws.send(connectPkt('probe' + Math.floor(Math.random()*1e6)));
    ws.onmessage = async ev => {
      let d;
      try { d = new Uint8Array(await new Response(ev.data).arrayBuffer()); }
      catch (e) { d = new Uint8Array(ev.data); }
      clearTimeout(t); res(url + ' OK type=0x' + d[0].toString(16) + ' rc=' + (d[3]||0));
      try{ws.close()}catch(e){}
    };
    ws.onerror = e => { clearTimeout(t); res(url + ' ERROR ' + (e.message||'')); };
  });
}
(async () => {
  for (const u of ['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt','wss://test.mosquitto.org:8081/mqtt'])
    console.log(await probe(u));
})();
