import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4183';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((p) => p.type === 'page' && p.url.startsWith(baseUrl));
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Chrome is still starting. */ }
    await wait(100);
  }
  throw new Error(`Chrome on port ${port} did not expose a page`);
}

async function client(id, port) {
  const profile = await mkdtemp(path.join(tmpdir(), `bulwark-hero-client-${id}-`));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,900', baseUrl,
  ], { stdio: 'ignore' });
  const ws = await connect(port);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
    return result.result?.result?.value;
  };
  const clickText = async (text) => {
    const clicked = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true} return false })()`);
    if (!clicked) throw new Error(`Client ${id}: button containing ${text} not found`);
    await wait(350);
  };
  try {
    await wait(500);
    await clickText('Play solo');
    const setupStarted = await evalJs(`(() => { const b=document.querySelector('.screen .btn.primary'); if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true} return false })()`);
    if (!setupStarted) throw new Error(`Client ${id}: setup confirmation not found`);
    await wait(900);
    await evalJs(`(() => { const b=document.querySelector('.ready-btn'); if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true} return false })()`);
    await wait(3500);
    const metrics = await evalJs(`new Promise(resolve => { let frames=0; const start=performance.now(); const tick=()=>{frames++; if(performance.now()-start>=1500){const s=window.__bulwark?.state(); const c=document.querySelector('canvas'); resolve({frames, elapsed:performance.now()-start, wave:s?.wave, tick:s?.tick, enemies:s?.enemies.length, towers:s?.towers.length, canvas:!!c, canvasSize:c?[c.width,c.height]:null, text:document.body.innerText.slice(0,120), overflow:document.documentElement.scrollWidth>innerWidth});} else requestAnimationFrame(tick)}; requestAnimationFrame(tick) })`, true);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.resolve(`client-${id}-game.png`), Buffer.from(shot.result.data, 'base64'));
    return { id, fps: Math.round(metrics.frames * 1000 / metrics.elapsed), ...metrics };
  } finally {
    ws.close();
    proc.kill();
    await wait(250);
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }).catch(() => {});
  }
}

const results = await Promise.all([client(1, 9331), client(2, 9332)]);
for (const result of results) console.log(JSON.stringify(result));
if (results.some((r) => !r.canvas || r.overflow || r.fps < 45 || r.tick < 60)) process.exitCode = 1;
