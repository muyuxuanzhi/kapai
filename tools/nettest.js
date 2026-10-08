// 联机链路自测：模拟两个客户端（两个 Net 实例）通过服务端打完整局
// 用法: node tools/nettest.js [局数，默认 2]
// 需要先启动服务端: node server.js 8000

import { Net } from '../src/ui/net.js';
import { legalActions } from '../src/engine/rules.js';

const BASE = 'http://localhost:8000';
const ROUNDS = Number(process.argv[2] || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Node 端没有 EventSource，用 fetch 流自己解析 SSE（浏览器端仍用原生 EventSource） */
async function attachSSE(c) {
  const res = await fetch(`${BASE}/api/stream?roomId=${c.roomId}&side=${c.side}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) c.emit(JSON.parse(line.slice(6)).e, JSON.parse(line.slice(6)));
        }
      }
    } catch { /* 连接关闭 */ }
  })();
}

function makeClient() {
  const c = new Net(BASE);
  c.openStream = () => {}; // Node 端改用 attachSSE
  c.state = null;
  const grab = (m) => { if (m.state) c.state = m.state; };
  c.on('GAME_START', grab);
  c.on('EVENTS', grab);
  c.on('STATE_SYNC', grab);
  return c;
}

async function playOne(i) {
  const a = makeClient();
  const created = await a.create({ partner: 'alice', deck: 'balanced', level: 10, name: 'A' });
  const roomId = created.roomId;

  await attachSSE(a);

  const b = makeClient();
  await b.join({ roomId, partner: 'hood', deck: 'forest', level: 10, name: 'B' });
  await attachSSE(b);

  // 等待开局
  for (let t = 0; t < 40 && (!a.state || !b.state); t++) await sleep(50);
  if (!a.state || !b.state) throw new Error('开局超时');

  let steps = 0;
  while (!a.state.over && steps++ < 300) {
    const side = a.state.current;
    const cli = side === a.side ? a : b;
    const st = cli.state;
    if (!st || st.over) break;

    const acts = legalActions(st, side).filter((x) => x.act !== 'END_TURN');
    let action = { act: 'END_TURN' };
    if (acts.length && Math.random() < 0.75) action = acts[Math.floor(Math.random() * acts.length)];

    const r = await cli.send(action);
    if (!r.ok) { console.log('  指令被拒:', r.msg, JSON.stringify(action)); }
    await sleep(40);
  }

  const winner = a.state.winner;
  const who = winner === -1 ? '平局' : winner === a.side ? 'A(玩家1)' : 'B(玩家2)';
  console.log(`第 ${i + 1} 局：房间 ${roomId} · ${steps} 步 · 结束回合 ${a.state.turn} · 胜方 ${who}` +
    ` · A 剩余 ${a.state.players[a.side].hp} / B 剩余 ${a.state.players[b.side].hp}`);

  a.close();
  b.close();
  return a.state.over;
}

/** AI 练习房：一个人的时候，服务端用 AI 扮演对手（走完全相同的联机链路） */
async function playAiOne(i) {
  const a = makeClient();
  await a.create({ partner: 'hood', deck: 'starter', level: 10, ai: true, aiDiff: 'normal', aiPartner: 'alice', aiDeck: 'balanced' });
  await attachSSE(a);
  for (let t = 0; t < 40 && !a.state; t++) await sleep(50);

  let steps = 0;
  while (!a.state.over && steps++ < 300) {
    const st = a.state;
    if (st.current !== a.side) { await sleep(60); continue; } // 等服务端跑 AI 回合
    const acts = legalActions(st, a.side).filter((x) => x.act !== 'END_TURN');
    const action = acts.length && Math.random() < 0.75
      ? acts[Math.floor(Math.random() * acts.length)]
      : { act: 'END_TURN' };
    const r = await a.send(action);
    if (!r.ok) console.log('  指令被拒:', r.msg);
    await sleep(60);
  }
  const w = a.state.winner;
  console.log(`AI 房第 ${i + 1} 局：${steps} 步 · 结束回合 ${a.state.turn} · ` +
    `${w === -1 ? '平局' : w === a.side ? '玩家胜' : 'AI 胜'}`);
  a.close();
  return a.state.over;
}

console.log('联机链路自测（两个客户端 + 权威服务端）');
let ok = 0;
for (let i = 0; i < ROUNDS; i++) {
  try {
    if (await playOne(i)) ok++;
  } catch (e) {
    console.log(`第 ${i + 1} 局失败：${e.message}`);
  }
}
console.log(ok === ROUNDS ? `全部 ${ROUNDS} 局联机对局跑通 ✅` : `${ok}/${ROUNDS} 局跑通 ❌`);

console.log('\nAI 练习房自测（一个人也能走联机链路）');
let okAi = 0;
for (let i = 0; i < 2; i++) {
  try { if (await playAiOne(i)) okAi++; } catch (e) { console.log(`AI 房第 ${i + 1} 局失败：${e.message}`); }
}
console.log(okAi === 2 ? 'AI 练习房跑通 ✅' : `AI 房 ${okAi}/2 跑通 ❌`);
