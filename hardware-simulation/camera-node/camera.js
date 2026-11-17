/* Phone camera node: getUserMedia + zero-dependency frame differencing.
   Authenticates to the platform with a device key (?key=...) issued by an admin.
   Detections are sent as events over the WebSocket; the server republishes them
   onto MQTT so they follow the same rule engine as every other sensor.
   Escalation: sustained motion (3+ detections within 30 s) is reported as
   "intrusion" (critical alarm); a single detection is "motion" (logged only). */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('video'), overlay = $('overlay'), proc = $('proc'), statusEl = $('status'), logEl = $('log'), siteSel = $('site'), startBtn = $('start'), sens = $('sens');
  const key = new URLSearchParams(location.search).get('key');
  let ws = null, prev = null, running = false, cooldownUntil = 0, retry = 0;
  const recent = [];

  function log(msg) {
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.prepend(d);
    while (logEl.children.length > 50) logEl.lastChild.remove();
  }

  function connect() {
    if (!key) { $('pair-warn').hidden = false; return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?device=${encodeURIComponent(key)}`);
    ws.onopen = () => { retry = 0; log('Connected to TowerIQ'); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello' && Array.isArray(m.sites)) {
        const saved = sessionStorage.getItem('cam_site');
        siteSel.innerHTML = '';
        for (const s of m.sites) { const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.name} (${s.id})`; siteSel.appendChild(o); }
        if (saved) siteSel.value = saved;
      }
    };
    ws.onclose = (ev) => {
      log(ev.code === 1006 && retry === 0 ? 'Connection refused: is the pairing key valid?' : 'Disconnected, retrying…');
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      running = true; prev = null;
      startBtn.textContent = 'Stop camera';
      statusEl.textContent = 'Watching for motion…';
      requestAnimationFrame(loop);
    } catch (err) {
      statusEl.textContent = 'Camera unavailable: ' + err.message + (location.protocol !== 'https:' && location.hostname !== 'localhost' ? ' (camera access needs HTTPS)' : '');
    }
  }
  function stop() {
    running = false;
    (video.srcObject?.getTracks() || []).forEach((t) => t.stop());
    video.srcObject = null;
    startBtn.textContent = 'Start camera';
    statusEl.textContent = 'Camera stopped.';
  }

  function loop() {
    if (!running) return;
    const ctx = proc.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, proc.width, proc.height);
    const frame = ctx.getImageData(0, 0, proc.width, proc.height);
    if (prev) {
      const { pct, box } = diff(prev, frame);
      draw(box, pct);
      const threshold = Number(sens.value) / 100;
      if (pct > threshold && Date.now() > cooldownUntil) {
        cooldownUntil = Date.now() + 4000;
        const now = Date.now();
        recent.push(now);
        while (recent.length && now - recent[0] > 30000) recent.shift();
        const sustained = recent.length >= 3;
        send(sustained ? 'intrusion' : 'motion', Math.min(0.99, 0.55 + pct * 4 + (sustained ? 0.15 : 0)));
        if (sustained) recent.length = 0;
      }
    }
    prev = frame;
    requestAnimationFrame(loop);
  }

  function diff(a, b) {
    const w = proc.width, hgt = proc.height;
    let changed = 0, n = 0, minX = w, minY = hgt, maxX = 0, maxY = 0;
    for (let y = 0; y < hgt; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      n++;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 70) {
        changed++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { pct: changed / n, box: changed > 6 ? { x: minX / w, y: minY / hgt, w: (maxX - minX) / w, h: (maxY - minY) / hgt } : null };
  }

  function draw(box, pct) {
    overlay.width = overlay.clientWidth; overlay.height = overlay.clientHeight;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const hit = pct > Number(sens.value) / 100;
    if (box && hit) { ctx.strokeStyle = '#f85149'; ctx.lineWidth = 3; ctx.strokeRect(box.x * overlay.width, box.y * overlay.height, Math.max(6, box.w * overlay.width), Math.max(6, box.h * overlay.height)); }
    statusEl.classList.toggle('alert', hit);
    statusEl.textContent = hit ? `Motion: ${(pct * 100).toFixed(1)}% of frame changed` : `Watching (${(pct * 100).toFixed(1)}% change)`;
  }

  function send(type, confidence) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { log('Offline: event not sent'); return; }
    ws.send(JSON.stringify({ type: 'camera-event', siteId: siteSel.value, event_type: type, confidence }));
    log(`Sent ${type.toUpperCase()} for ${siteSel.value} (confidence ${confidence.toFixed(2)})`);
  }

  siteSel.addEventListener('change', () => { try { sessionStorage.setItem('cam_site', siteSel.value); } catch { /* ignore */ } });
  startBtn.addEventListener('click', () => (running ? stop() : start()));
  connect();
})();
