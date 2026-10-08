// 用 CDP 直连 headless chrome，加载页面 → 执行 JS 点击进入对战 → 截图保存
// 用法: node tools/shot.js <chrome.exe路径> <输出png路径> [JS表达式]
import { spawn } from 'child_process';
import fs from 'fs';

const CHROME = process.argv[2];
const OUT = process.argv[3];
const EVAL = process.argv[4] || '';
const PORT = 9333;

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' });

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  let list = null;
  for (let i = 0; i < 20 && !list; i++) {
    await wait(400);
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { /* retry */ }
  }
  if (!list) throw new Error('chrome 调试端口未就绪');
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await wait(1200);
  if (EVAL) {
    await send('Runtime.evaluate', { expression: EVAL, awaitPromise: true });
    await wait(1400);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('已保存:', OUT);
  ws.close();
  proc.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
