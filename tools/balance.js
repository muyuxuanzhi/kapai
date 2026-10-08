// 自动配平伙伴的 skillScale：迭代反馈搜索，使每个伙伴对其他三伙伴的总胜率趋近 50%
// 用法: node tools/balance.js [每组合局数，默认 100] [迭代轮数，默认 6] [等级，默认 10]

import { createGame, applyAction } from '../src/engine/rules.js';
import { runAiTurn } from '../src/engine/ai.js';
import { PARTNERS, PARTNER_LIST } from '../src/data/partners.js';
import { DECKS } from '../src/data/decks.js';

const N = Number(process.argv[2] || 100);
const ITER = Number(process.argv[3] || 6);
const LEVEL = Number(process.argv[4] || 10);
const ids = PARTNER_LIST.map((h) => h.id);

function play(partnerA, partnerB, seed, first) {
  let st = createGame({
    deckA: DECKS.balanced.cards, deckB: DECKS.balanced.cards,
    partnerA, partnerB, levelA: LEVEL, levelB: LEVEL, seed, first,
  });
  let guard = 0;
  while (!st.over && guard++ < 400) {
    const before = st;
    const r = runAiTurn(st, st.current, 'normal');
    st = r.state;
    if (st === before) st = applyAction(st, { act: 'END_TURN' }).state;
  }
  return st.winner;
}

function winRate(hero) {
  let win = 0, tot = 0;
  for (const other of ids) {
    if (other === hero) continue;
    for (let i = 0; i < N; i++) {
      if (play(hero, other, 9000 + i * 7, i % 2) === 0) win++;
      tot++;
    }
    for (let i = 0; i < N; i++) {
      if (play(other, hero, 9000 + i * 7, i % 2) === 1) win++;
      tot++;
    }
  }
  return (win / tot) * 100;
}

console.log(`自动配平：每组合 ${N} 局 × ${ITER} 轮 × Lv${LEVEL}\n`);
for (let it = 0; it < ITER; it++) {
  const rates = {};
  for (const id of ids) rates[id] = winRate(id);
  const line = ids.map((id) => `${id} ${rates[id].toFixed(1)}% (k=${PARTNERS[id].skillScale.toFixed(2)})`).join('  ');
  const worst = Math.max(...ids.map((id) => Math.abs(rates[id] - 50)));
  console.log(`轮 ${it + 1}: ${line}   最大偏离 ${worst.toFixed(1)}`);
  if (worst <= 6) { console.log('  → 已收敛'); break; }
  for (const id of ids) {
    const d = rates[id] - 50;
    PARTNERS[id].skillScale = Math.max(0.2, Math.min(4, PARTNERS[id].skillScale * (1 - d / 110)));
  }
}

console.log('\n最终 skillScale：');
for (const id of ids) console.log(`  ${id}: ${PARTNERS[id].skillScale.toFixed(3)}`);
console.log('\n把上面的数值写入 src/data/partners.js 对应伙伴的 skillScale');
