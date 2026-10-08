// 用 CDP 直连 headless chrome：进入对战 → 自动点「回合结束」N 次 → 收集控制台报错
// 用法: node tools/autoplay.js <chrome.exe路径> <轮数> [输出png]
import { spawn } from 'child_process';
import fs from 'fs';

const CHROME = process.argv[2];
const ROUNDS = Number(process.argv[3] || 10);
const OUT = process.argv[4] || '';
const PORT = 9334;

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
  const consoleMsgs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const level = msg.params.type;
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (level === 'error' || level === 'warning') consoleMsgs.push(`[${level}] ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
    }
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await wait(1000);
  await send('Runtime.evaluate', {
    expression: `document.querySelectorAll(".home-nav button")[3].click(); document.getElementById("btnStartAi").click(); "ok"`,
  });
  await wait(1200);

  let overText = '';
  for (let i = 0; i < ROUNDS; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `
        (function(){
          const over = !document.getElementById('overlay').classList.contains('hidden');
          if (over) return 'GAME_OVER:' + document.getElementById('ovText').textContent;
          const btn = document.getElementById('btnEnd');
          if (btn.disabled) return 'WAITING';
          btn.click();
          return 'CLICKED';
        })()
      `,
    });
    const val = r.result?.result?.value || '';
    if (val.startsWith('GAME_OVER')) { overText = val; break; }
    await wait(2600); // 等动画播完（约 2 次攻击序列）
  }

  if (!overText) {
    const r = await send('Runtime.evaluate', {
      expression: `document.getElementById('turnInfo').textContent`,
    });
    overText = '未结束，当前：' + (r.result?.result?.value || '?');
  }

  console.log(`\n结果: ${overText}`);
  console.log(`控制台错误/警告/异常: ${consoleMsgs.length} 条`);
  for (const m of consoleMsgs.slice(0, 30)) console.log('  ❌ ' + m);

  if (OUT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('截图: ' + OUT);
  }

  ws.close();
  proc.kill();
  process.exit(consoleMsgs.length ? 1 : 0);
}
main().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
