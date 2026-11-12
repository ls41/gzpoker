/* 网络层：优先 WebSocket（低延迟）；WS 连不上时自动改用 HTTP 长轮询（穿透代理/防火墙）
 * 两者在服务端共用同一张房间表，所以混用也能互相看见。
 * ?net=http 可强制轮询，?net=mqtt 可改用公网 MQTT（纯静态托管兜底）。
 */
(function (root) {
  function createNet(opt) {
    const emit = m => { try { opt.onMsg && opt.onMsg(m); } catch (e) {} };
    const st = (s, k) => { try { opt.onStatus && opt.onStatus(s, k); } catch (e) {} };
    let send = null, wsFails = 0, dead = false;
    const pending = [];
    const cid = 'c' + Math.random().toString(36).slice(2, 9);
    const room = encodeURIComponent(opt.room || '');
    const forceHttp = new URLSearchParams(location.search).get('net') === 'http';
    const forceMqtt = new URLSearchParams(location.search).get('net') === 'mqtt';

    function flush() { pending.splice(0).forEach(m => send && send(m)); }

    /* ---------- HTTP 长轮询 ---------- */
    function startHTTP() {
      if (dead) return; dead = true;
      let ok = false;
      send = m => {
        try {
          fetch('/api/msg?room=' + room, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(m) }).catch(() => {});
        } catch (e) {}
      };
      (async function loop() {
        while (true) {
          try {
            const r = await fetch('/api/poll?room=' + room + '&cid=' + cid, { cache: 'no-store' });
            const arr = await r.json();
            if (!ok) { ok = true; st('on', 'http'); flush(); opt.onConnect && opt.onConnect(); }
            if (Array.isArray(arr)) arr.forEach(emit);
          } catch (e) {
            if (ok) { ok = false; st('off', 'http'); }
            await new Promise(r => setTimeout(r, 1200));
          }
        }
      })();
      st('off', 'http');
    }

    /* ---------- WebSocket ---------- */
    function startWS() {
      if (forceHttp) return startHTTP();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = proto + '//' + location.host + '/ws?room=' + room;
      let ws;
      try { ws = new root.WebSocket(wsUrl); } catch (e) { return retryWS(); }
      let opened = false;
      const timer = setTimeout(() => { if (!opened) { try { ws.close(); } catch (e) {} } }, 2200);
      ws.onopen = () => {
        opened = true; wsFails = 0; clearTimeout(timer);
        ws.send(JSON.stringify({ t: 'sub', room: opt.room }));
        send = m => { try { ws.send(JSON.stringify(m)); } catch (e) {} };
        flush();
        st('on', 'ws'); opt.onConnect && opt.onConnect();
      };
      ws.onmessage = e => { try { emit(JSON.parse(e.data)); } catch (err) {} };
      ws.onerror = () => {};
      ws.onclose = () => { clearTimeout(timer); if (opened) st('off', 'ws'); retryWS(); };
    }
    function retryWS() {
      wsFails++;
      st('off', 'ws');
      if (wsFails >= 2) return startHTTP();     // 两次失败 → 换 HTTP 长轮询
      setTimeout(startWS, 800);
    }

    /* ---------- 公网 MQTT（仅在 ?net=mqtt 时） ---------- */
    function startMQTT() {
      if (!root.mqtt) { st('error', 'mqtt'); return; }
      const client = root.mqtt.connect(opt.mqttUrl, {
        clientId: 'wp_' + Math.random().toString(16).slice(2, 10),
        clean: true, reconnectPeriod: 2500, connectTimeout: 8000, keepalive: 30
      });
      client.on('connect', () => { st('on', 'mqtt'); client.subscribe(opt.topic, { qos: 0 }); opt.onConnect && opt.onConnect(); });
      client.on('reconnect', () => st('off', 'mqtt'));
      client.on('close', () => st('off', 'mqtt'));
      client.on('error', () => st('error', 'mqtt'));
      client.on('message', (t, p) => { try { emit(JSON.parse(p.toString())); } catch (e) {} });
      send = m => { try { client.publish(opt.topic, JSON.stringify(m), { qos: 0 }); } catch (e) {} };
      flush();
    }

    if (forceMqtt) return startMQTT();
    // 探测是否运行在本项目中继服务上：有 → WS/轮询；无（GitHub Pages 等静态托管）→ MQTT
    fetch('/api/ping', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && j.srv === 'gzpoker') startWS(); else startMQTT(); })
      .catch(() => startMQTT());
    return { send: m => (send ? send(m) : pending.push(m)) };
  }
  root.createNet = createNet;
})(window);
