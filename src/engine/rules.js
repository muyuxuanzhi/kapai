// 《童话奇境》规则引擎（M0 内核）
//
// 概念区分（重要）：
//   · 【伙伴】= 出战角色本体（爱丽丝/小红帽/桃乐丝/疯帽子），局外切换，各有主动/被动/终极技能
//   · 【助手卡】= 卡牌，打到场上 3 个助手位，是独立单位（不是伙伴的形态）
//   · 【奇遇卡】= 卡牌，即时生效后消失
//
// 纯函数：applyAction(state, action) -> { state, events }
// 真人联机、AI、批量模拟共用同一份。

import { nextRandom, shuffle } from './rng.js';
import { CARD_INDEX } from '../data/cards.js';
import { PARTNERS, partnerStats, skillValue, TUNE, secondShieldFor } from '../data/partners.js';
import { resonanceOf } from '../data/decks.js';

export const MAX_TURN = 30; // 全局回合计数：双方各行动一次 = 2，即每人 15 个回合
export const HAND_MAX = 6;
export const SLOTS = 3;
export const CLEAR_COST = 1; // 扫除残骸所需的梦力

/**
 * 卡位规则（重要）：助手被打死后【不会离场】，而是变成「残骸」继续占着卡位。
 *  · 残骸不能攻击、不能被选为目标，攻击会穿过它打向伙伴本体
 *  · 残骸占着卡位 → 无法在该位放新卡
 *  · 必须花 CLEAR_COST 点梦力「扫除」才能腾出卡位
 */

const clone = (o) =>
  typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));

// ────────────────────────── 创建对局 ──────────────────────────

export function createGame(cfg) {
  const {
    deckA, deckB, partnerA = 'hood', partnerB = 'hood',
    levelA = 1, levelB = 1, seed = 1, first = 0,
  } = cfg;

  let rng = seed >>> 0;
  const st = {
    seed, rng, turn: 1, current: first, first,
    players: [], nextUid: 1, over: false, winner: null, events: [],
  };

  const mk = (deck, partnerId, level) => {
    const s = partnerStats(partnerId, level);
    const [pile, r] = shuffle(deck, rng);
    rng = r;
    return {
      partnerId, level,                 // partnerId 即「伙伴」id
      hp: s.hp, maxHp: s.hp, atk: s.atk, shield: 0,
      board: [null, null, null],     // 3 个助手位
      startAtkBonus: 0,
      healReduce: 0, healReduceUntil: 0, // 「减疗」debuff
      deckBase: deck.slice(), drawPile: pile, hand: [],
      turnCount: 0,
      mana: 0, manaMax: 0,
      costReduce: 0, costReduceUntil: 0,
      tempAtk: 0, tempUntil: 0,
      blessing: null,
      skills: { active: { cd: 0 }, ultimate: { cd: 0 } },
      passiveUsed: 0, reflectTurn: -1, reflectCount: 0,
      heroSkip: false,        // 被「聚光灯」等控制：下次战斗结算不攻击
      skillSealUntil: 0,      // 被「禁言」：到该回合前不能使用主动技
      stats: { damage: 0, skillDamage: 0, cardsPlayed: 0 },
    };
  };

  st.players = [mk(deckA, partnerA, levelA), mk(deckB, partnerB, levelB)];
  st.players[0].blessing = resonanceOf(deckA, CARD_INDEX);
  st.players[1].blessing = resonanceOf(deckB, CARD_INDEX);

  // 起始手牌：先手 4 张，后手 4 + secondHandExtra 张（先手在其第 1 回合还会再抽 1 张）
  const extra = TUNE.secondHandExtra || 0;
  drawCards(st, 0, first === 0 ? 3 : 4 + extra);
  drawCards(st, 1, first === 1 ? 3 : 4 + extra);
  st.players[1 - first].skipFirstDraw = true;

  for (const side of [0, 1]) {
    const p = st.players[side];
    if (p.blessing === 'wonder') drawCards(st, side, 2); // 仙境共鸣：资源优势（原为 1 张，实测阵营胜率仅 27%）
    if (p.blessing === 'forest') p.startAtkBonus = 1; // 月夜狩猎：本局召唤的助手 +2 攻击
    if (p.blessing === 'oz') p.shield += 6;
    // 后手补偿护盾：tools/tune.js 扫描时可用 TUNE.secondShieldOverride 覆盖
    const shieldVal = TUNE.secondShieldOverride !== undefined
      ? TUNE.secondShieldOverride
      : secondShieldFor(p.level);
    if (side !== first) p.shield += shieldVal;
  }

  startTurn(st);
  return st;
}

// ────────────────────────── 基础操作 ──────────────────────────

/**
 * 抽牌池 = 卡组中【当前不在场上】的卡。
 * 关键规则：一张卡只要还在场上（无论是存活还是残骸），本局就不会再被抽到；
 * 只有残骸被扫除、卡位腾空后，它才有机会再次刷新出来。
 */
function availablePool(st, p) {
  // 同一张卡任一时刻只能存在一份：要么在手上、要么在卡位上（存活或残骸）
  const used = new Set();
  for (const u of p.board) if (u) used.add(u.cardId);
  for (const h of p.hand) used.add(h.cardId);
  return p.deckBase.filter((id) => !used.has(id));
}

function drawCards(st, side, n) {
  const p = st.players[side];
  for (let i = 0; i < n; i++) {
    const pool = availablePool(st, p);
    if (!pool.length) { st.events.push({ e: 'NO_CARD', side }); continue; }
    const [r, s2] = nextRandom(st.rng);
    st.rng = s2;
    const cardId = pool[Math.floor(r * pool.length)];
    if (p.hand.length >= HAND_MAX) {
      st.events.push({ e: 'HAND_FULL', side, card: cardId });
      continue;
    }
    const uid = 'h' + st.nextUid++;
    p.hand.push({ uid, cardId });
    st.events.push({ e: 'DRAW', side, card: cardId, uid });
  }
}

function startTurn(st) {
  const side = st.current;
  const p = st.players[side];
  const pas = PARTNERS[p.partnerId].skills.passive;

  p.turnCount++;
  p.manaMax = Math.min(10, p.turnCount + 1);
  if (p.turnCount <= TUNE.secondManaTurns && side !== st.first) p.manaMax += 1; // 后手补偿
  if (p.turnCount === 1 && p.blessing === 'wonder') p.manaMax += 1;
  if (p.level >= pas.unlock && pas.op === 'manaEvery3' && p.turnCount % 3 === 0) p.manaMax += pas.value;
  p.mana = p.manaMax;

  if (p.tempUntil <= p.turnCount) p.tempAtk = 0;
  // 只给存活的助手恢复攻击能力；残骸（dead）永远保持 canAttack=false
  for (const u of p.board) if (u && !u.dead) u.canAttack = true;

  if (!(p.skipFirstDraw && p.turnCount === 1)) drawCards(st, side, 1);

  if (p.level >= pas.unlock && pas.op === 'drawChance' && p.passiveUsed < pas.max) {
    const [r, s2] = nextRandom(st.rng);
    st.rng = s2;
    if (r < pas.chance) {
      drawCards(st, side, 1);
      p.passiveUsed++;
      st.events.push({ e: 'PASSIVE', side, name: pas.name, text: '额外抽 1 张' });
    }
  }
  st.events.push({ e: 'TURN_START', side, turn: st.turn, mana: p.manaMax });
}

function makeUnit(st, card, p, override) {
  return {
    uid: 'u' + st.nextUid++,
    cardId: card.id,
    name: override?.name || card.name,
    hp: override?.hp ?? card.hp,
    maxHp: override?.hp ?? card.hp,
    atk: (override?.atk ?? card.atk) + (p.startAtkBonus || 0),
    taunt: !!card.keywords?.includes('taunt'),
    firstStrike: card.keywords?.includes('firstStrike') ? 2 : 0,
    doubleOnce: !!card.keywords?.includes('doubleOnce'),
    doubleUsed: false,
    // 放置后，本回合结束的结算中即可攻击（流程：放置 → 结束回合 → 卡牌攻击）
    canAttack: true,
    token: !!override,
  };
}

function effCost(st, p, card) {
  const red = p.costReduceUntil > p.turnCount ? p.costReduce : 0;
  return Math.max(0, card.cost - red);
}

// ────────────────────────── 伤害 / 治疗 ──────────────────────────

function dealToUnit(st, side, slot, dmg, opts = {}) {
  const p = st.players[side];
  const u = p.board[slot];
  if (!u || u.dead || dmg <= 0) return; // 残骸不再承受伤害
  const before = u.hp;
  u.hp -= dmg;
  st.events.push({ e: 'DMG_UNIT', side, slot, value: dmg, hp: Math.max(0, u.hp), hpBefore: before });
  countDamage(st, opts, dmg);
  if (u.hp <= 0) {
    const over = -u.hp;
    u.hp = 0;
    u.dead = true;      // 变成残骸，继续占着卡位
    u.canAttack = false;
    st.events.push({ e: 'DEATH', side, slot, name: u.name });
    onUnitDeath(st, side);
    if (opts.overflow && over > 0) dealToHero(st, side, over, opts);
  }
}

function dealToHero(st, side, dmg, opts = {}) {
  const p = st.players[side];
  let d = dmg;
  if (p.shield > 0) {
    const abs = Math.min(p.shield, d);
    p.shield -= abs;
    d -= abs;
    st.events.push({ e: 'SHIELD', side, value: abs, left: p.shield });
  }
  const before = p.hp;
  if (d > 0) p.hp -= d;
  st.events.push({ e: 'DMG_HERO', side, value: dmg, hp: Math.max(0, p.hp), hpBefore: before });
  countDamage(st, opts, dmg);

  const pas = PARTNERS[p.partnerId].skills.passive;
  const canReflect =
    p.level >= pas.unlock && pas.op === 'reflect' &&
    opts.attackerSide !== undefined && opts.attackerSide !== side && opts.source !== 'passive';
  if (canReflect) {
    if (p.reflectTurn !== st.turn) { p.reflectTurn = st.turn; p.reflectCount = 0; }
    if (p.reflectCount < pas.perTurn) {
      p.reflectCount++;
      st.events.push({ e: 'PASSIVE', side, name: pas.name, text: `反弹 ${pas.value}` });
      dealToHero(st, opts.attackerSide, pas.value, { source: 'passive', side });
    }
  }
}

function countDamage(st, opts, dmg) {
  const side = opts.side;
  if (side === undefined) return;
  st.players[side].stats.damage += dmg;
  if (opts.source === 'skill' || opts.source === 'passive') st.players[side].stats.skillDamage += dmg;
}

function healHero(st, p, v) {
  const before = p.hp;
  // 「减疗」debuff（爱丽丝直伤附带）：持续期间每次治疗被固定扣减
  let amount = v;
  if (p.healReduceUntil > p.turnCount && p.healReduce > 0) {
    amount = Math.max(0, amount - p.healReduce);
  }
  p.hp = Math.min(p.maxHp, p.hp + amount);
  st.events.push({ e: 'HEAL_HERO', side: st.players.indexOf(p), value: p.hp - before, hp: p.hp });
}

function onUnitDeath(st, side) {
  const p = st.players[side];
  const pas = PARTNERS[p.partnerId].skills.passive;
  if (p.level >= pas.unlock && pas.op === 'atkOnDeath' && p.passiveUsed < pas.max) {
    p.atk += pas.value;
    p.passiveUsed += pas.value;
    st.events.push({ e: 'PASSIVE', side, name: pas.name, text: `伙伴攻击 +${pas.value}` });
  }
  // 小红帽「林间回响」：我方助手死亡时伙伴回血（对症：被清场流克制时不会完全崩盘）
  if (p.level >= pas.unlock && pas.op === 'healOnDeath' && p.passiveUsed < pas.max) {
    p.passiveUsed++;
    healHero(st, p, pas.value);
    // 同时补 1 张牌：被清场后能重建场面（只回血不补牌时仍会被清场流打崩）
    if (pas.drawAlso) drawCards(st, side, 1);
    st.events.push({ e: 'PASSIVE', side, name: pas.name, text: `伙伴回复 ${pas.value}${pas.drawAlso ? '，抽 1 张' : ''}` });
  }
}

// ────────────────────────── 效果执行 ──────────────────────────

function applyEffects(st, p, effects, ctx = {}) {
  const side = st.players.indexOf(p);
  const foe = 1 - side;
  for (const ef of effects || []) {
    switch (ef.op) {
      case 'draw':
        drawCards(st, side, ef.value);
        break;
      case 'mana':
        p.mana += ef.value;
        st.events.push({ e: 'MANA', side, value: ef.value });
        break;
      case 'healHero':
        healHero(st, p, ef.value);
        break;
      case 'shield':
        p.shield += ef.value;
        st.events.push({ e: 'SHIELD_GAIN', side, value: ef.value, left: p.shield });
        break;
      case 'dmgHero':
        dealToHero(st, foe, ef.value, { source: 'card', side, attackerSide: side });
        break;
      case 'dmgOne': {
        const t = ctx.target;
        if (t && st.players[t.side].board[t.slot]) {
          dealToUnit(st, t.side, t.slot, ef.value, { source: 'card', side, attackerSide: side, overflow: ef.overflow });
        }
        break;
      }
      case 'dmgAll':
        for (let s = 0; s < SLOTS; s++) {
          dealToUnit(st, foe, s, ef.value, { source: 'card', side, attackerSide: side, overflow: ef.overflow });
        }
        break;
      case 'buffAll':
        for (const u of p.board) {
          if (!u || u.dead) continue;
          u.atk += ef.atk || 0;
          if (ef.hp) { u.hp += ef.hp; u.maxHp += ef.hp; }
        }
        st.events.push({ e: 'BUFF_ALL', side, atk: ef.atk || 0, hp: ef.hp || 0 });
        break;
      case 'buffOne': {
        const t = ctx.target;
        const u = t && st.players[t.side].board[t.slot];
        if (u && !u.dead) {
          u.atk += ef.atk || 0;
          if (ef.hp) { u.hp += ef.hp; u.maxHp += ef.hp; }
        }
        break;
      }
      case 'healOne': {
        const t = ctx.target;
        const u = t && st.players[t.side].board[t.slot];
        if (u && !u.dead) {
          if (ef.raiseMax) { u.maxHp += ef.value; u.hp += ef.value; }
          else u.hp = Math.min(u.maxHp, u.hp + ef.value);
        }
        break;
      }
      // ── 控制类（对齐原作「控制卡/控制技能」）──
      case 'disableUnit': { // 敌方一个助手下回合不能攻击（玺源凯·慢动作 / 香水）
        const t = ctx.target;
        const u = t && st.players[t.side].board[t.slot];
        if (u && !u.dead) {
          u.skipNext = true;
          st.events.push({ e: 'DEBUFF', side: t.side, name: u.name, text: '下回合无法攻击' });
        }
        break;
      }
      case 'disableHero': { // 敌方伙伴下回合不能攻击（聚光灯）
        st.players[foe].heroSkip = true;
        st.events.push({ e: 'DEBUFF', side: foe, name: '伙伴', text: '下回合无法攻击' });
        break;
      }
      case 'sealSkill': { // N 回合内双方不能使用主动技（禁言）
        for (const s of [0, 1]) {
          st.players[s].skillSealUntil = Math.max(
            st.players[s].skillSealUntil,
            Math.max(st.players[0].turnCount, st.players[1].turnCount) + (ef.value || 2),
          );
        }
        st.events.push({ e: 'DEBUFF', side, name: '双方', text: `${ef.value || 2} 回合内禁用主动技` });
        break;
      }
      case 'halveAtk': {
        const alive = st.players[foe].board.filter((x) => x && !x.dead);
        if (alive.length) {
          const [r, s2] = nextRandom(st.rng);
          st.rng = s2;
          const target = alive[Math.floor(r * alive.length)];
          target.atk = Math.floor(target.atk / 2);
          st.events.push({ e: 'DEBUFF', side: foe, name: target.name, text: '攻击力减半' });
        }
        break;
      }
      case 'costReduce':
        p.costReduce = ef.value;
        p.costReduceUntil = p.turnCount + ef.turns;
        break;
      case 'coinflip': {
        const [r, s2] = nextRandom(st.rng);
        st.rng = s2;
        applyEffects(st, p, [r < 0.5 ? ef.a : ef.b], ctx);
        break;
      }
    }
  }
}

// ────────────────────────── 行动 ──────────────────────────

function doPlay(st, p, action) {
  const side = st.players.indexOf(p);
  const idx = p.hand.findIndex((h) => h.uid === action.uid);
  if (idx < 0) return false;
  const card = CARD_INDEX[p.hand[idx].cardId];
  const cost = effCost(st, p, card);
  if (cost > p.mana) return false;

  if (card.type === 'companion') {
    if (action.slot === undefined || p.board[action.slot]) return false;
    p.mana -= cost;
    p.hand.splice(idx, 1);
    st.events.push({ e: 'PLAY', side, uid: action.uid, card: card.id, name: card.name });
    p.board[action.slot] = makeUnit(st, card, p);
    st.events.push({ e: 'SUMMON', side, slot: action.slot, card: card.id, name: card.name });
    applyEffects(st, p, card.effects, { sourceCard: card });
  } else {
    p.mana -= cost;
    p.hand.splice(idx, 1);
    st.events.push({ e: 'PLAY', side, uid: action.uid, card: card.id, name: card.name });
    applyEffects(st, p, card.effects, { sourceCard: card, target: action.target });
  }
  p.stats.cardsPlayed++;
  return true;
}

/** 扫除残骸：花 CLEAR_COST 点梦力腾出卡位 */
function doClear(st, p, action) {
  const side = st.players.indexOf(p);
  const slot = action.slot;
  const u = p.board[slot];
  if (!u || !u.dead) return false;
  if (p.mana < CLEAR_COST) return false;
  p.mana -= CLEAR_COST;
  p.board[slot] = null;
  st.events.push({ e: 'CLEAR', side, slot, name: u.name });
  return true;
}

function doSkill(st, p, action) {
  const side = st.players.indexOf(p);
  const foe = 1 - side;
  const key = action.skill;
  const sk = PARTNERS[p.partnerId].skills[key];
  if (!sk || p.level < sk.unlock || p.skills[key].cd > 0 || sk.cost > p.mana) return false;

  p.mana -= sk.cost;
  p.skills[key].cd = sk.cd;
  const scale = PARTNERS[p.partnerId].skillScale ?? 1;
  const val = Math.round(skillValue(sk, p.level) * scale);
  st.events.push({ e: 'SKILL', side, skill: key, name: sk.name, value: val });

  const runExtra = (a) => {
    if (!a) return;
    const v = Math.round((a.base !== undefined ? skillValue(a, p.level) : a.value || 0) * scale);
    const o = { source: 'skill', side, attackerSide: side };
    if (a.op === 'dmgHero') dealToHero(st, foe, v, o);
    else if (a.op === 'dmgAll') for (let s = 0; s < SLOTS; s++) dealToUnit(st, foe, s, v, o);
    else if (a.op === 'healHero') healHero(st, p, v);
    else if (a.op === 'draw') drawCards(st, side, a.value || 1);
    else if (a.op === 'buffAll') {
      applyEffects(st, p, [{ op: 'buffAll', hp: Math.round((a.hp || 0) * scale), atk: Math.round((a.atk || 0) * scale) }]);
    }
    else if (a.op === 'healReduce') {          // 减疗：让直伤能压制治疗续航流
      const q = st.players[foe];
      q.healReduce = v;
      q.healReduceUntil = q.turnCount + (a.turns || 2);
      st.events.push({ e: 'DEBUFF', side: foe, name: '减疗', text: `${a.turns || 2} 回合内治疗 -${v}` });
    }
  };

  switch (sk.op) {
    case 'dmgHero':
      dealToHero(st, foe, val, { source: 'skill', side, attackerSide: side });
      runExtra(sk.also);
      runExtra(sk.also2);
      break;
    case 'healHero':
      healHero(st, p, val);
      runExtra(sk.also);
      runExtra(sk.also2);
      break;
    case 'dmgOne': {
      const t = action.target;
      if (t && st.players[t.side].board[t.slot]) {
        const before = st.players[t.side].board[t.slot];
        dealToUnit(st, t.side, t.slot, val, { source: 'skill', side, attackerSide: side });
        const after = st.players[t.side].board[t.slot];
        if (!after || after.dead) { if (sk.onKill === 'draw') drawCards(st, side, 1); }
        void before;
      }
      break;
    }
    case 'dmgAll':
      for (let s = 0; s < SLOTS; s++) {
        dealToUnit(st, foe, s, val, { source: 'skill', side, attackerSide: side });
      }
      break;
    case 'buffAllTemp':
      p.tempAtk += Math.round(sk.atk * scale);
      p.tempUntil = p.turnCount + sk.dur;
      st.events.push({ e: 'BUFF_ALL', side, atk: Math.round(sk.atk * scale), hp: 0, turns: sk.dur });
      break;
    case 'summon': {
      const slot = p.board.findIndex((b) => !b);
      if (slot < 0) return false;
      p.board[slot] = makeUnit(st, CARD_INDEX.c15, p, {
        name: '影子茶客',
        hp: Math.round(sk.hp * scale),
        atk: Math.round(sk.atk * scale),
      });
      st.events.push({ e: 'SUMMON', side, slot, card: 'token', name: '影子茶客' });
      break;
    }
  }
  return true;
}

// ────────────────────────── 战斗结算（同时结算） ──────────────────────────

/** 找对方场上的嘲讽单位（位次最小）：嘲讽在场时，敌方【所有】目标都优先攻击它 */
function findTaunt(q) {
  for (let i = 0; i < SLOTS; i++) {
    const u = q.board[i];
    if (u && !u.dead && u.taunt) return i;
  }
  return -1;
}

function collectUnitAttack(st, side, slot, intents) {
  const p = st.players[side];
  const q = st.players[1 - side];
  const u = p.board[slot];
  if (!u || u.dead || !u.canAttack) return;
  if (u.skipNext) { u.skipNext = false; return; } // 被控制：本回合不能攻击
  const atk = u.atk + (p.tempUntil > p.turnCount ? p.tempAtk : 0);

  // 目标优先级：① 对方有嘲讽 → 全部打嘲讽 ② 否则打对位 ③ 对位空/残骸 → 打对方伙伴本体
  const taunt = findTaunt(q);
  const toSlot = taunt >= 0 ? taunt : (q.board[slot] && !q.board[slot].dead ? slot : -1);

  if (u.firstStrike && toSlot >= 0) {
    intents.push({ fromSide: side, fromSlot: slot, toSide: 1 - side, toSlot, dmg: u.firstStrike, kind: '先伤' });
  }
  intents.push({ fromSide: side, fromSlot: slot, toSide: 1 - side, toSlot, dmg: atk });
  if (u.doubleOnce && !u.doubleUsed) {
    u.doubleUsed = true;
    intents.push({ fromSide: side, fromSlot: slot, toSide: 1 - side, toSlot, dmg: atk });
  }
}

function collectHeroAttack(st, side, intents) {
  const p = st.players[side];
  const q = st.players[1 - side];
  if (p.heroSkip) { p.heroSkip = false; return; } // 被控制：本回合不攻击
  let slot = -1;
  for (let i = 0; i < SLOTS; i++) if (q.board[i] && !q.board[i].dead && q.board[i].taunt) { slot = i; break; }
  if (slot < 0) for (let i = 0; i < SLOTS; i++) if (q.board[i] && !q.board[i].dead) { slot = i; break; }
  intents.push({ fromSide: side, fromSlot: -1, toSide: 1 - side, toSlot: slot, dmg: p.atk });
}

function applyIntents(st, intents) {
  for (const it of intents) {
    if (st.over) break;
    const target = it.toSlot >= 0 ? st.players[it.toSide].board[it.toSlot] : null;
    const slot = target && !target.dead ? it.toSlot : -1;
    st.events.push({
      e: it.fromSlot < 0 ? 'HERO_ATTACK' : 'ATTACK',
      from: { side: it.fromSide, slot: it.fromSlot },
      to: { side: it.toSide, slot }, value: it.dmg, kind: it.kind || '普攻',
    });
    const opts = { source: 'attack', side: it.fromSide, attackerSide: it.fromSide };
    if (slot >= 0) dealToUnit(st, it.toSide, slot, it.dmg, opts);
    else dealToHero(st, it.toSide, it.dmg, opts);
    checkWin(st);
  }
}

/**
 * 回合制攻击结算：**只有当前行动方发起攻击**，防守方不反击。
 *
 * 之前的实现里双方会在同一次结算中互相攻击（防守方也打回去），
 * 导致"每有一个人结束回合，双方就交换一轮伤害"，既不是回合制、节奏也翻倍。
 * 改为回合制后：轮到谁的回合，就只有那一方的助手 + 伙伴攻击。
 */
/**
 * 回合制攻击结算，严格分两个阶段、逐个结算 —— 便于逐步展示：
 *   ① 卡牌阶段：当前方的助手【一个一个】攻击，每张打完立刻出伤害/死亡
 *   ② 角色阶段：所有助手打完后，伙伴才发起攻击
 *
 * 之前是"收集全部攻击意图后统一结算"，卡牌与角色同时出手，画面上完全看不清先后顺序。
 */
/**
 * 【交替回合制】—— 对齐原版《奥比岛·偶像之战》：
 *   轮到谁的回合，就由谁出牌 → 结束时【只有这一方】攻击；对方不反击，等轮到它的回合再打回来。
 *   （原版佐证：攻略说"先手优先放上来直接攻击，后手就要找对方相应位置没卡的位置"，
 *    说明先手攻击时对方场上还是空的 → 只有当前行动方出手。）
 *
 * 内部顺序仍是「先卡牌、后角色」：
 *   ① 当前方的助手逐个攻击（每张单独结算，看清打谁）
 *   ② 助手全部打完后，当前方的伙伴（角色）再攻击
 *
 * 先手优势交给后手补偿处理（梦力 / 护盾，见 TUNE 与 secondShieldFor）。
 */
function resolveCombat(st) {
  const me = st.current;

  // ① 卡牌阶段：当前方助手逐个攻击
  for (let i = 0; i < SLOTS; i++) {
    if (st.over) return;
    const one = [];
    collectUnitAttack(st, me, i, one);
    if (one.length) applyIntents(st, one);
  }

  // ② 角色阶段：卡牌打完后，当前方伙伴再攻击
  if (st.over) return;
  const hero = [];
  collectHeroAttack(st, me, hero);
  if (hero.length) applyIntents(st, hero);
}

function checkWin(st) {
  if (st.over) return;
  for (let i = 0; i < 2; i++) {
    if (st.players[i].hp <= 0) {
      st.over = true;
      st.winner = 1 - i;
      st.events.push({ e: 'GAME_OVER', winner: 1 - i, reason: 'hero_dead' });
      return;
    }
  }
}

function doEndTurn(st) {
  // 交替回合制：每一方结束回合时，由【该方】发起攻击（对方不反击）
  // 「准备回合」：双方各自的第 1 个回合只铺场、不攻击。
  // 否则先手方第 1 回合就能对着空场直接打偶像（白赚一次输出），实测先手胜率 88~92%；
  // 有了准备回合，双方都是从第 2 个回合才开始互相打，先手只保留"先铺场"的正常优势。
  const cur = st.players[st.current];
  if (cur.turnCount > 1) {
    resolveCombat(st);
    checkWin(st);
  }
  if (st.over) return;

  const p = st.players[st.current];
  p.skills.active.cd = Math.max(0, p.skills.active.cd - 1);
  p.skills.ultimate.cd = Math.max(0, p.skills.ultimate.cd - 1);

  st.turn++;
  if (st.turn > MAX_TURN) {
    const r0 = st.players[0].hp / st.players[0].maxHp;
    const r1 = st.players[1].hp / st.players[1].maxHp;
    st.over = true;
    st.winner = Math.abs(r0 - r1) < 1e-9 ? -1 : r0 > r1 ? 0 : 1;
    st.events.push({ e: 'GAME_OVER', winner: st.winner, reason: 'turn_limit' });
    return;
  }
  st.current = 1 - st.current;
  startTurn(st);
}

// ────────────────────────── 对外 API ──────────────────────────

export function legalActions(state, side = state.current) {
  const out = [];
  if (state.over || state.current !== side) return out;
  const p = state.players[side];
  const foe = 1 - side;

  for (const h of p.hand) {
    const card = CARD_INDEX[h.cardId];
    if (effCost(state, p, card) > p.mana) continue;
    if (card.type === 'companion') {
      for (let s = 0; s < SLOTS; s++) {
        if (!p.board[s]) out.push({ act: 'PLAY_CARD', uid: h.uid, cardId: card.id, slot: s });
      }
    } else if (card.needTarget === 'enemyUnit') {
      for (let s = 0; s < SLOTS; s++) {
        const u = state.players[foe].board[s];
        if (u && !u.dead) out.push({ act: 'PLAY_CARD', uid: h.uid, cardId: card.id, target: { side: foe, slot: s } });
      }
    } else if (card.needTarget === 'allyUnit') {
      for (let s = 0; s < SLOTS; s++) {
        if (p.board[s] && !p.board[s].dead) out.push({ act: 'PLAY_CARD', uid: h.uid, cardId: card.id, target: { side, slot: s } });
      }
    } else {
      out.push({ act: 'PLAY_CARD', uid: h.uid, cardId: card.id });
    }
  }

  // 扫除残骸：腾出被占死的卡位
  for (let s = 0; s < SLOTS; s++) {
    const u = p.board[s];
    if (u && u.dead && p.mana >= CLEAR_COST) out.push({ act: 'CLEAR_SLOT', slot: s });
  }

  for (const key of ['active', 'ultimate']) {
    const sk = PARTNERS[p.partnerId].skills[key];
    if (p.level < sk.unlock || p.skills[key].cd > 0 || sk.cost > p.mana) continue;
    // 「禁言」只封主动技（对齐原作：2 回合内无法使用主动技能）
    if (key === 'active' && p.skillSealUntil > p.turnCount) continue;
    if (sk.op === 'dmgOne') {
      for (let s = 0; s < SLOTS; s++) {
        const u = state.players[foe].board[s];
        if (u && !u.dead) out.push({ act: 'USE_SKILL', skill: key, target: { side: foe, slot: s } });
      }
    } else if (sk.op === 'summon') {
      if (p.board.some((b) => !b)) out.push({ act: 'USE_SKILL', skill: key });
    } else {
      out.push({ act: 'USE_SKILL', skill: key });
    }
  }

  out.push({ act: 'END_TURN' });
  return out;
}

export function applyAction(state, action) {
  const st = clone(state);
  st.events = [];
  let ok = false;
  const p = st.players[st.current];

  if (action.act === 'PLAY_CARD') ok = doPlay(st, p, action);
  else if (action.act === 'USE_SKILL') ok = doSkill(st, p, action);
  else if (action.act === 'CLEAR_SLOT') ok = doClear(st, p, action);
  else if (action.act === 'END_TURN') { doEndTurn(st); ok = true; }

  checkWin(st);
  return { state: st, events: st.events, ok };
}

export { effCost };
