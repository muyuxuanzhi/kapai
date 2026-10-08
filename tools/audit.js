// 自动体检：跑批量对局，逐步校验不变量 + 统计卡牌/残骸/节奏数据
// 用法: node tools/audit.js [局数] [等级]
import { createGame, applyAction } from '../src/engine/rules.js';
import { chooseAction } from '../src/engine/ai.js';
import { DECKS } from '../src/data/decks.js';
import { CARD_INDEX } from '../src/data/cards.js';
import { PARTNER_LIST } from '../src/data/partners.js';

const N = Number(process.argv[2] || 120);
const LEVEL = Number(process.argv[3] || 10);

const issues = [];
const bug = (msg) => { if (issues.length < 40) issues.push(msg); };

let games = 0, draws = 0, turnSum = 0;
let corpseCount = 0, clearCount = 0, jamCount = 0, handFull = 0, noCard = 0;
let deaths = 0, dmgEvents = 0, skillUse = 0;
const cardPlay = {};   // cardId → { plays, wins }
const partnerUse = {}; // partnerId → { games, wins }

function snapshot(st) {
  const snap = new Map();
  for (const side of [0, 1]) {
    for (let s = 0; s < 3; s++) {
      const u = st.players[side].board[s];
      snap.set(`${side}:${s}`, u ? { uid: u.uid, dead: !!u.dead, hp: u.hp } : null);
    }
  }
  return snap;
}

function checkState(st, tag) {
  for (const side of [0, 1]) {
    const p = st.players[side];
    if (!Number.isFinite(p.hp) || !Number.isFinite(p.atk) || !Number.isFinite(p.mana)) {
      bug(`${tag} 数值 NaN: hp=${p.hp} atk=${p.atk} mana=${p.mana}`);
    }
    if (p.shield < 0) bug(`${tag} 护盾为负 ${p.shield}`);
    if (p.mana < 0) bug(`${tag} 梦力为负 ${p.mana}`);
    if (p.mana > p.manaMax) bug(`${tag} 梦力超上限 ${p.mana}/${p.manaMax}`);
    if (p.hand.length < 0) bug(`${tag} 手牌为负`);
    if (p.board.length !== 3) bug(`${tag} 卡位数 ${p.board.length}`);
    for (let s = 0; s < 3; s++) {
      const u = p.board[s];
      if (!u) continue;
      if (u.hp < 0) bug(`${tag} 助手血量为负 ${u.hp}（${u.name}）`);
      if (u.dead && u.hp !== 0) bug(`${tag} 残骸血量非 0：${u.hp}（${u.name}）`);
      if (u.dead && u.canAttack) bug(`${tag} 残骸仍可攻击（${u.name}）`);
      if (!Number.isFinite(u.atk)) bug(`${tag} 攻击 NaN（${u.name}）`);
    }
  }
}

function checkEvents(events, before, st, tag) {
  for (const e of events) {
    if (e.e === 'DMG_UNIT') {
      dmgEvents++;
      if (e.value <= 0) bug(`${tag} DMG_UNIT 伤害非正 ${e.value}`);
      // 受击前必须还活着（残骸不该被攻击）
      const hpBefore = e.hpBefore;
      if (hpBefore === undefined) bug(`${tag} DMG_UNIT 缺少 hpBefore`);
      else if (hpBefore <= 0) bug(`${tag} 残骸被攻击了（受击前 hp=${hpBefore}）`);
    }
    if (e.e === 'DEATH') {
      deaths++;
      const b = before.get(`${e.side}:${e.slot}`);
      if (b && b.dead) bug(`${tag} 对残骸重复触发死亡（${e.name}）`);
      const u = st.players[e.side].board[e.slot];
      if (!u) bug(`${tag} 死亡后卡位被清空（${e.name}）`);
      else if (!u.dead) bug(`${tag} 死亡但未标记 dead（${e.name}）`);
    }
    if (e.e === 'SUMMON' || e.e === 'PLAY') {
      const slot = e.slot;
      if (slot !== undefined) {
        const b = before.get(`${e.side}:${slot}`);
        if (b) bug(`${tag} 放置到了已占用的卡位 ${slot}（残骸/单位仍在）`);
      }
    }
    if (e.e === 'HAND_FULL') handFull++;
    if (e.e === 'NO_CARD') noCard++;
    if (e.e === 'SKILL') skillUse++;
    if (e.e === 'CLEAR') clearCount++;
  }
}

for (let i = 0; i < N; i++) {
  const deckName = ['starter', 'balanced', 'forest', 'wonder', 'oz'][i % 5];
  // 随机配对（固定配对会把"循环克制"放大成假失衡）
  const rnd = (k) => { const x = Math.sin(k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const pa = PARTNER_LIST[Math.floor(rnd(i + 1) * PARTNER_LIST.length)].id;
  const pb = PARTNER_LIST[Math.floor(rnd(i + 99) * PARTNER_LIST.length)].id;
  const first = i % 2;
  let st = createGame({
    deckA: DECKS[deckName].cards, deckB: DECKS[deckName].cards,
    partnerA: pa, partnerB: pb, levelA: LEVEL, levelB: LEVEL, seed: 20000 + i, first,
  });

  for (const id of [pa, pb]) {
    partnerUse[id] = partnerUse[id] || { games: 0, wins: 0 };
    partnerUse[id].games++;
  }

  const playedBy = [new Set(), new Set()];
  let guard = 0;
  while (!st.over && guard++ < 400) {
    const side = st.current;
    const before = snapshot(st);
    const action = chooseAction(st, side, 'normal');
    const r = applyAction(st, action);
    if (!r.ok) { st = applyAction(st, { act: 'END_TURN' }).state; continue; }
    st = r.state;
    for (const e of r.events) if (e.e === 'PLAY') playedBy[side].add(e.card);
    checkEvents(r.events, before, st, `seed${20000 + i}`);
    checkState(st, `seed${20000 + i}`);
  }
  if (guard >= 400) bug(`seed${20000 + i} 对局无法结束（>400 步）`);
  if (st.winner === -1) draws++;
  turnSum += st.turn;
  games++;

  for (const side of [0, 1]) {
    for (const cid of playedBy[side]) {
      cardPlay[cid] = cardPlay[cid] || { plays: 0, wins: 0 };
      cardPlay[cid].plays++;
      if (st.winner === side) cardPlay[cid].wins++;
    }
  }
  if (st.winner === 0) partnerUse[pa].wins++;
  if (st.winner === 1) partnerUse[pb].wins++;

  // 终局残骸堵塞统计
  for (const side of [0, 1]) {
    const b = st.players[side].board;
    const corpses = b.filter((u) => u && u.dead).length;
    corpseCount += corpses;
    if (corpses === 3) jamCount++;
  }
}

console.log(`\n════ 自动体检：${games} 局 / Lv${LEVEL} ════\n`);
console.log(`不变量违规：${issues.length} 条`);
for (const m of issues.slice(0, 20)) console.log('  ❌ ' + m);
if (!issues.length) console.log('  ✅ 未发现违规（残骸未被攻击 / 无负血 / 无重复死亡 / 无卡位冲突）');

console.log(`\n── 节奏 ──`);
console.log(`  平均回合(每人)   ${(turnSum / games / 2).toFixed(1)}`);
console.log(`  平局(打满回合)   ${((draws / games) * 100).toFixed(1)}%`);
console.log(`  助手死亡         ${deaths} 次 / ${games} 局 = ${(deaths / games).toFixed(1)} 次每局`);
console.log(`  残骸扫除         ${clearCount} 次`);
console.log(`  终局场上残骸     ${corpseCount}（其中"3 位全残骸"堵塞 ${jamCount} 次）`);
console.log(`  手牌满溢出       ${handFull} 次`);
console.log(`  牌库抽空         ${noCard} 次`);
console.log(`  技能释放         ${skillUse} 次 = ${(skillUse / games).toFixed(1)} 次每局`);

console.log(`\n── 伙伴胜率 ──`);
for (const [id, v] of Object.entries(partnerUse).sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
  const r = (v.wins / v.games) * 100;
  console.log(`  ${id.padEnd(10)} ${r.toFixed(1).padStart(5)}%  (${v.games} 局) ${r < 40 || r > 60 ? '⚠' : ''}`);
}

console.log(`\n── 卡牌出场与携带胜率 ──`);
const rows = Object.entries(cardPlay).sort((a, b) => b[1].plays - a[1].plays);
for (const [cid, v] of rows) {
  const c = CARD_INDEX[cid];
  const wr = (v.wins / v.plays) * 100;
  const flag = v.plays >= 20 && (wr < 40 || wr > 62) ? '  ⚠' : '';
  console.log(`  ${(c ? c.name : cid).padEnd(12)} ${(v.plays / games).toFixed(2).padStart(5)} 次/局   胜率 ${wr.toFixed(0).padStart(3)}%${flag}`);
}
const unplayed = Object.values(CARD_INDEX).filter((c) => !cardPlay[c.id]);
console.log(`\n  从未被打出的卡：${unplayed.length} 张 ${unplayed.map((c) => c.name).join('、')}`);
console.log(`\n${issues.length ? '❌ 存在问题' : '✅ 体检通过'}\n`);
process.exit(issues.length ? 1 : 0);
