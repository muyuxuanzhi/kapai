// 打印一局的事件流，用于核对「先卡牌攻击、再角色攻击」「双方各出手一次」
// 用法: node tools/trace.js [seed]
import { createGame, applyAction } from '../src/engine/rules.js';
import { runAiTurn } from '../src/engine/ai.js';
import { DECKS } from '../src/data/decks.js';

const SEED = Number(process.argv[2] || 7);
let st = createGame({
  deckA: DECKS.starter.cards, deckB: DECKS.starter.cards,
  partnerA: 'hood', partnerB: 'alice', levelA: 10, levelB: 10, seed: SEED, first: 0,
});

// 用 slot 编号显示（单位名字会随状态变化而读不准，编号才稳定）
const nm = (side, slot) => {
  if (slot < 0 || slot === undefined) return `P${side}·角色`;
  const u = st.players[side].board[slot];
  return `P${side}#${slot}${u ? `${u.dead ? '(残骸)' : ''}${u.name}` : '(空)'}`;
};

const MAX_TURNS = Number(process.argv[3] || 4); // 只看前几个回合
let guard = 0;
let turns = 0;
console.log(`\n═══ 事件流 seed=${SEED}（只看前 ${MAX_TURNS} 个回合）═══\n`);

while (!st.over && guard++ < 80 && turns < MAX_TURNS) {
  const side = st.current;
  const r = runAiTurn(st, side, 'normal');
  let header = false;
  for (const s of r.steps) {
    for (const e of s.events) {
      if (e.e === 'TURN_START') {
        console.log(`\n── 第 ${e.turn} 回合：轮到 P${e.side}（梦力 ${e.mana}）──`);
        header = true;
        continue;
      }
      if (e.e === 'ATTACK') {
        console.log(`  🃏 卡牌 ${nm(e.from.side, e.from.slot)} → ${nm(e.to.side, e.to.slot)}  伤害 ${e.value}`);
      } else if (e.e === 'HERO_ATTACK') {
        console.log(`  👤 角色 ${nm(e.from.side, -1)} → ${nm(e.to.side, e.to.slot)}  伤害 ${e.value}`);
      } else if (e.e === 'DMG_UNIT') {
        console.log(`       💥 ${nm(e.side, e.slot)} 受到 ${e.value}（${e.hpBefore} → ${e.hp}）`);
      } else if (e.e === 'DMG_HERO') {
        console.log(`       💥 角色${e.side} 受到 ${e.value}（${e.hpBefore} → ${e.hp}）`);
      } else if (e.e === 'DEATH') {
        console.log(`       ☠ ${e.name} 变成残骸`);
      }
    }
  }
  st = r.state;
  if (header) turns++;
  if (r.steps.length && r.steps[r.steps.length - 1].action.act !== 'END_TURN') {
    st = applyAction(st, { act: 'END_TURN' }).state;
  }
}
console.log('\n（说明：卡牌攻击应全部排在角色攻击之前；双方都应各有一次卡牌攻击）\n');
