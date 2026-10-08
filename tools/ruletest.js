// 规则回归测试：确认「卡跨回合留在卡位」「死亡变残骸不消失」「场上卡不会被再抽到」
// 用法: node tools/ruletest.js

import { createGame, applyAction, legalActions, CLEAR_COST } from '../src/engine/rules.js';
import { chooseAction } from '../src/engine/ai.js';
import { CARD_INDEX } from '../src/data/cards.js';
import { DECKS } from '../src/data/decks.js';

let fail = 0;
const t = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
};

const mk = (seed, first = 0) => createGame({
  deckA: DECKS.starter.cards, deckB: DECKS.starter.cards,
  partnerA: 'hood', partnerB: 'hood', levelA: 10, levelB: 10, seed, first,
});

// ── 1. 出牌后留在卡位，且跨回合仍在原位 ──
{
  let st = null;
  let play = null;
  for (let seed = 1; seed < 40 && !play; seed++) {
    st = mk(seed);
    play = legalActions(st, 0).find((a) => a.act === 'PLAY_CARD' && CARD_INDEX[a.cardId].type === 'companion');
  }
  if (!play) t('能找到可出的助手卡', false);
  else {
    st = applyAction(st, play).state;
    const slot = play.slot;
    t('出牌后卡在卡位上', !!st.players[0].board[slot]);
    const uidBefore = st.players[0].board[slot].uid;
    st = applyAction(st, { act: 'END_TURN' }).state;      // 我方回合结束（含战斗结算）
    st = applyAction(st, { act: 'END_TURN' }).state;      // 对手回合结束 → 回到我方
    const u = st.players[0].board[slot];
    // 只要卡位没有被清空即可；期间它可能被打死变成残骸，这也是正确行为
    t('跨回合后卡仍在【原来的卡位】（未被清空）', !!u && u.uid === uidBefore,
      `槽 ${slot} · ${u ? (u.dead ? '已成残骸' : `存活 ${u.hp}/${u.maxHp}`) : '消失'}`);
  }
}

// ── 2. 战斗结算致死后变残骸，卡位不被清空 ──
{
  let deaths = 0, nulledAfterDeath = 0, corpseKept = 0;
  for (let seed = 0; seed < 40; seed++) {
    let st = mk(seed, seed % 2);
    let guard = 0;
    while (!st.over && guard++ < 300) {
      const r = applyAction(st, chooseAction(st, st.current, 'normal'));
      if (!r.ok) break;
      st = r.state;
      for (const e of r.events) {
        if (e.e !== 'DEATH') continue;
        deaths++;
        const u = st.players[e.side].board[e.slot];
        if (!u) nulledAfterDeath++;              // ← 不该发生
        else if (u.dead) corpseKept++;           // ← 期望：残骸留在卡位
      }
    }
  }
  t('整局出现过助手死亡', deaths > 0, `${deaths} 次`);
  t('死亡后卡位【没有】被清空', nulledAfterDeath === 0, `异常 ${nulledAfterDeath} 次`);
  t('死亡后卡位留下残骸', corpseKept === deaths, `${corpseKept}/${deaths}`);
}

// ── 3. 残骸可花 1 梦力扫除，扫除后卡位空出 ──
{
  let st = mk(7);
  let guard = 0;
  let cleared = false;
  while (!st.over && guard++ < 300) {
    const side = st.current;
    // 优先尝试扫除
    const clear = legalActions(st, side).find((a) => a.act === 'CLEAR_SLOT');
    if (clear) {
      const before = st.players[side].board[clear.slot];
      const r = applyAction(st, clear);
      st = r.state;
      if (r.ok) {
        cleared = true;
        t('残骸可被扫除（−1 梦力）', st.players[side].board[clear.slot] === null, `槽 ${clear.slot}（原 ${before?.name}）`);
        break;
      }
    } else {
      const r = applyAction(st, chooseAction(st, side, 'normal'));
      if (!r.ok) break;
      st = r.state;
    }
  }
  t('整局中找到了可扫除的残骸', cleared);
}

// ── 4. 场上已有的卡不会被再次抽到 ──
{
  let bad = 0, checks = 0;
  for (let seed = 0; seed < 30; seed++) {
    let st = mk(seed, seed % 2);
    let guard = 0;
    while (!st.over && guard++ < 300) {
      const r = applyAction(st, chooseAction(st, st.current, 'normal'));
      if (!r.ok) break;
      st = r.state;
      for (const side of [0, 1]) {
        const onField = new Set(st.players[side].board.filter(Boolean).map((u) => u.cardId));
        for (const h of st.players[side].hand) {
          checks++;
          if (onField.has(h.cardId)) bad++; // 手牌里不该出现已在场上的卡
        }
      }
    }
  }
  t('手牌中不会出现已在场上的卡', bad === 0, `检查 ${checks} 次，异常 ${bad} 次`);
}

console.log(fail === 0 ? '\n全部规则回归测试通过 ✅' : `\n${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
