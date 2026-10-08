// 参数扫描：标定「后手补偿」三件套（额外手牌 / 梦力回合 / 开局护盾）
// 目标：Lv10 与 Lv30 的先手胜率都落在 50%~56%，且对局 6~12 回合。
// 用法: node tools/tune.js [每格局数，默认 120]

import { createGame } from '../src/engine/rules.js';
import { runAiTurn } from '../src/engine/ai.js';
import { TUNE } from '../src/data/partners.js';
import { DECKS } from '../src/data/decks.js';

const N = Number(process.argv[2] || 120);

function measure(level) {
  let win = 0, turns = 0;
  for (let i = 0; i < N; i++) {
    const first = i % 2;
    let st = createGame({
      deckA: DECKS.balanced.cards, deckB: DECKS.balanced.cards,
      partnerA: 'alice', partnerB: 'alice',
      levelA: level, levelB: level, seed: 7000 + i * 13, first,
    });
    let guard = 0;
    while (!st.over && guard++ < 400) {
      const r = runAiTurn(st, st.current, 'normal');
      st = r.state;
    }
    if (st.winner === first) win++;
    turns += st.turn;
  }
  return { rate: (win / N) * 100, turns: turns / N / 2 };
}

const grid = [];
for (const hand of [0, 1]) {
  for (const mana of [2, 3, 4]) {
    for (const sh of [0, 6, 12]) grid.push({ hand, mana, sh });
  }
}

console.log(`后手补偿扫描（每格 ${N} 局 × Lv10/Lv30）`);
console.log('手牌 梦力 护盾 | Lv10 先手/回合 | Lv30 先手/回合 | score');
const rows = [];
for (const g of grid) {
  TUNE.secondHandExtra = g.hand;
  TUNE.secondManaTurns = g.mana;
  TUNE.secondShieldFixed = g.sh;
  // 用固定值覆盖随等级公式
  const orig = TUNE.secondShieldOverride;
  TUNE.secondShieldOverride = g.sh;
  const a = measure(10);
  const b = measure(30);
  void orig;
  const pen = (x) => Math.max(0, 50 - x) + Math.max(0, x - 56);
  const penT = (t) => Math.max(0, 6 - t) * 2 + Math.max(0, t - 12) * 2;
  const score = pen(a.rate) + pen(b.rate) + penT(a.turns) + penT(b.turns);
  rows.push({ ...g, a, b, score });
  console.log(`${String(g.hand).padEnd(4)} ${String(g.mana).padEnd(4)} ${String(g.sh).padEnd(4)} | ` +
    `${a.rate.toFixed(1).padStart(6)}% ${a.turns.toFixed(1).padStart(5)} | ` +
    `${b.rate.toFixed(1).padStart(6)}% ${b.turns.toFixed(1).padStart(5)} | ${score.toFixed(1)}`);
}

rows.sort((x, y) => x.score - y.score);
console.log('\n最佳 3 组：');
for (const r of rows.slice(0, 3)) {
  console.log(`  手牌+${r.hand} 梦力${r.mana}回合 护盾${r.sh}` +
    `  Lv10 ${r.a.rate.toFixed(1)}%/${r.a.turns.toFixed(1)}  Lv30 ${r.b.rate.toFixed(1)}%/${r.b.turns.toFixed(1)}  score=${r.score.toFixed(1)}`);
}
