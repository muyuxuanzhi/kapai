// 试玩界面（M1 + M2）
// 本地 AI 模式：applyAction 在本地执行
// 联机模式：只发意图给服务端，画面完全由服务端下发的 state / events 驱动
// 【伙伴】= 出战角色（局外切换）；【助手卡】= 打到 3 个助手位的单位；两者互不相关

import { createGame, applyAction, effCost, MAX_TURN } from '../engine/rules.js';
import { chooseAction } from '../engine/ai.js';
import { CARD_INDEX, SPELL_KIND, FACTION_META } from '../data/cards.js';
import { PARTNERS, PARTNER_LIST } from '../data/partners.js';
import { DECKS, resonanceOf, BLESSING_TEXT } from '../data/decks.js';
import { Net } from './net.js';
import { initHome, showHome, showGame } from './home.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ST = null;
let busy = false;
let selected = null;
let dragUid = null;      // 正在拖拽的手牌 uid
let diff = 'normal';
let level = 10;

// 动画期的"显示血量"覆盖：让头顶伤害数字先飘出来，血条随后才下降
// hpOverride: `${viewSide}:${slot}` 或 `hero:${viewSide}` → 暂时显示这个血量
// aliveOverride: 这些单位在伤害动画播完前仍按存活渲染（否则状态已是最终态，会直接显示"残骸"）
const hpOverride = new Map();
const aliveOverride = new Set();
const unitKey = (v, s) => `${v}:${s}`;
const heroKey = (v) => `hero:${v}`;
function clearAnimOverride() { hpOverride.clear(); aliveOverride.clear(); }

let mode = 'ai';            // 'ai' | 'online'
let mySide = 0;             // 我在 state.players 里的真实索引
let view = [0, 1];          // 视图索引 → 真实索引（0=我方/下方，1=敌方/上方）
const net = new Net();

// 主页选择的伙伴与卡组（6 张助手卡 + 2 张奇遇卡）
let currentPartner = 'hood';
let currentDeck = DECKS.starter.cards;

const V = (realSide) => (realSide === mySide ? 0 : 1); // 真实 side → 视图 side
const R = (viewSide) => view[viewSide];                // 视图 side → 真实 side

/** 已渲染过的单位 uid：用来判断"是否是新上场"，从而只给新卡播放置动画 */
const rendered = new Set();

// ────────────── 初始化 ──────────────
function initSelects() {
  $('btnNew').onclick = () => { if (mode === 'online') return hint('联机中，请先点「AI 练习」'); newGame(); };
  $('btnEnd').onclick = endTurn;
  $('ovBtn').onclick = () => { $('overlay').classList.add('hidden'); if (mode === 'ai') newGame(); };
  $('selDiff').onchange = (e) => (diff = e.target.value);
  $('selLevel').onchange = (e) => (level = Number(e.target.value));

  $('btnCreate').onclick = createRoom;
  $('btnJoin').onclick = joinRoom;
  $('btnSolo').onclick = backToSolo;
  $('btnGear').onclick = () => $('settings').classList.toggle('hidden');
  $('btnBackHome').onclick = backHome;
  $('ovHome').onclick = () => { $('overlay').classList.add('hidden'); backHome(); };
  bindNet();

  // 战场整体作为奇遇卡的投放区：拖到卡位附近松手即用
  const bf = $('battlefield');
  bf.ondragover = (ev) => { ev.preventDefault(); };
  bf.ondragenter = () => {
    // 正在拖的是「无需选目标」的奇遇卡时，整个战场泛起金光提示"松手即可施放"
    if (!dragUid || !selected) return;
    const card = CARD_INDEX[selected.cardId];
    if (card && card.type === 'spell' && !card.needTarget) bf.classList.add('field-drop-hint');
  };
  bf.ondragleave = (ev) => { if (!bf.contains(ev.relatedTarget)) bf.classList.remove('field-drop-hint'); };
  bf.ondrop = (ev) => { ev.preventDefault(); bf.classList.remove('field-drop-hint'); dropOnField(); };
}

function backHome() {
  net.close();
  mode = 'ai';
  mySide = 0;
  view = [0, 1];
  showHome();
}

function currentOpts() {
  return { partner: currentPartner, deckIds: currentDeck, level };
}

async function createRoom() {
  try {
    await net.create(currentOpts());
    mode = 'online';
    mySide = net.side;
    view = [mySide, 1 - mySide];
    $('roomTag').textContent = `房间 ${net.roomId} · 你是玩家${mySide + 1}`;
    log(`房间已创建：${net.roomId} —— 把房间码发给好友，或自己再开一个标签页加入`);
  } catch (e) { hint(e.message); }
}

async function joinRoom() {
  const id = ($('roomInput').value || '').trim().toUpperCase();
  if (!id) return hint('请输入房间码');
  try {
    await net.join({ ...currentOpts(), roomId: id });
    mode = 'online';
    mySide = net.side;
    view = [mySide, 1 - mySide];
    $('roomTag').textContent = `房间 ${net.roomId} · 你是玩家${mySide + 1}`;
    log(`已加入房间 ${net.roomId}`);
  } catch (e) { hint(e.message); }
}

function backToSolo() {
  net.close();
  mode = 'ai';
  mySide = 0;
  view = [0, 1];
  $('roomTag').textContent = '';
  newGame();
}

function bindNet() {
  net.on('GAME_START', (m) => { if (m.state) { ST = m.state; selected = null; render(); } log('对局开始'); });
  net.on('EVENTS', async (m) => {
    if (m.state) ST = m.state;
    render();
    busy = true;
    await playEvents(m.events || []);   // 联机时对手的动作同样播放动画
    busy = false;
    render();
    checkOver();
  });
  net.on('STATE_SYNC', (m) => { if (m.state) { ST = m.state; render(); } log('已重新同步对局'); });
  net.on('GAME_OVER', (m) => {
    if (m.state) ST = m.state;
    ST.over = true;
    ST.winner = m.winner;
    render();
    checkOver();
  });
  net.on('OPPONENT_OFFLINE', () => log('对手掉线，60 秒内可重连'));
  net.on('NET_ERROR', () => hint('连接中断，正在重连…'));
}

function newGame() {
  const deck = currentDeck;
  const aiDeck = DECKS[['starter', 'forest', 'wonder', 'oz', 'balanced'][Math.floor(Math.random() * 5)]].cards;
  const aiPartner = PARTNER_LIST[Math.floor(Math.random() * PARTNER_LIST.length)].id;
  const first = Math.random() < 0.5 ? 0 : 1;

  ST = createGame({
    deckA: deck, deckB: aiDeck,
    partnerA: currentPartner, partnerB: aiPartner,
    levelA: level, levelB: level,
    seed: (Math.random() * 1e9) | 0, first,
  });

  selected = null;
  busy = false;
  const pn = PARTNERS[currentPartner];
  log(`—— 新对局：你（${pn.name}） vs AI（${PARTNERS[aiPartner].name}），${first === 0 ? '你先手' : '对手先手'} ——`);
  const b = resonanceOf(deck, CARD_INDEX);
  log(b ? `你的故事共鸣：${BLESSING_TEXT[b]}` : '你的卡组未触发故事共鸣（助手卡同阵营需 ≥3 张）');
  render();
  if (ST.current === 1) aiTurn();
}

// ────────────── 渲染 ──────────────
function sideName(v) { return v === 0 ? '你' : '对手'; }

function render() {
  if (!ST) return;
  const me = ST.players[R(0)];
  const foe = ST.players[R(1)];
  const myTurn = ST.current === mySide;
  $('turnInfo').textContent = `回合 ${ST.turn}/${MAX_TURN} · ${myTurn ? '你的回合' : '对手回合'}`;

  for (let v = 0; v < 2; v++) {
    const p = ST.players[R(v)];
    const pt = PARTNERS[p.partnerId];
    $(`partnerArt${v}`).src = pt.art;
    $(`partnerName${v}`).textContent = `${pt.name}·${pt.title}（Lv${p.level}）`;
    const ohp = hpOverride.get(heroKey(v));           // 动画期：血条稍后才降
    // 显示血量需 clamp 到 0（p.hp 瞬间可能是负数，比如一击溢出到 -5，实测截图里出现过 "-5 / 33"）
    const sHp = Math.max(0, ohp !== undefined ? ohp : p.hp);
    $(`hpFill${v}`).style.width = Math.max(0, (sHp / p.maxHp) * 100) + '%';
    $(`hpText${v}`).textContent = `${sHp} / ${p.maxHp}${p.shield ? ` 🛡${p.shield}` : ''}`;
    $(`partnerStat${v}`).textContent = `攻击 ${p.atk}${p.tempUntil > p.turnCount ? ` (+${p.tempAtk})` : ''}`;

    $(`skills${v}`).innerHTML = ['active', 'ultimate'].map((k) => {
      const sk = pt.skills[k];
      const locked = p.level < sk.unlock;
      const cd = p.skills[k].cd;
      const usable = v === 0 && !locked && cd === 0 && sk.cost <= p.mana && myTurn && !ST.over;
      const icon = k === 'ultimate' ? '🌟' : '⚡';
      const title = locked
        ? `${sk.name}：Lv${sk.unlock} 解锁`
        : `${sk.name}：消耗 ${sk.cost} 梦力 · 冷却 ${sk.cd} 回合` + (cd > 0 ? '（冷却中）' : '');
      const inner = locked ? '🔒' : cd > 0 ? `<span class="cd">${cd}</span>` : icon;
      return `<div class="skill ${k === 'ultimate' ? 'ult' : ''} ${usable ? '' : 'disabled'}"
        data-v="${v}" data-skill="${k}" title="${title}">${inner}</div>`;
    }).join('');
  }

  document.querySelectorAll('#skills0 .skill').forEach((el) => {
    el.onclick = () => {
      if (el.classList.contains('disabled') || busy) return;
      trySkill(el.dataset.skill);
    };
  });

  for (let v = 0; v < 2; v++) {
    const p = ST.players[R(v)];
    const box = $(`slots${v}`);
    box.innerHTML = '';
    for (let s = 0; s < 3; s++) {
      const u = p.board[s];
      const uk = unitKey(v, s);
      const showDead = !!u && u.dead && !aliveOverride.has(uk);
      const el = document.createElement('div');
      el.className = 'slot' + (v === 0 ? ' mine' : '') + (u ? '' : ' empty') + (showDead ? ' has-corpse' : '');
      el.dataset.v = v; el.dataset.slot = s;
      if (u) {
        const card = CARD_INDEX[u.cardId];
        const isNew = !rendered.has(u.uid);
        if (isNew) rendered.add(u.uid);
        const tags = [];
        if (u.taunt) tags.push('嘲讽');
        if (u.firstStrike) tags.push('先伤');
        if (u.doubleOnce && !u.doubleUsed) tags.push('连击');
        // 动画期覆盖：伤害数字先飘，血条后降，最后才变残骸
        const showHp = hpOverride.has(uk) ? hpOverride.get(uk) : u.hp;
        el.innerHTML =`<div class="unit ${showDead ? 'dead' : ''} ${isNew && !u.dead ? 'summoned' : ''}" id="u-${v}-${s}">
          <img src="${card ? `assets/art/cards/${u.cardId}.svg` : 'assets/art/ui/slot_empty.svg'}" alt="">
          <div class="u-name">${showDead ? '残骸' : u.name}</div>
          ${showDead
            ? `<div class="clear-tip">扫除 1 梦力</div>`
            : `<div class="u-hp">${showHp}</div><div class="u-atk">${u.atk}</div>`}
          ${tags.length ? `<div class="u-tag">${tags.join(' ')}</div>` : ''}
        </div>`;
      } else {
        el.innerHTML = `<div style="opacity:.5">空位</div>`;
      }
      el.onclick = () => onSlotClick(v, s);
      if (u) attachTip(el, () => unitTipHtml(u));
      el.ondragover = (ev) => { ev.preventDefault(); };
      // 拖拽悬停反馈：合法目标（已有 can-drop/targetable/ally-target/clearable class）→ 放大金光；
      // 非法目标 → 红色抖动拒绝提示
      el.ondragenter = (ev) => {
        ev.preventDefault();
        const legal = el.classList.contains('can-drop') || el.classList.contains('targetable')
          || el.classList.contains('ally-target') || el.classList.contains('clearable');
        el.classList.toggle('drag-over', legal);
        el.classList.toggle('drag-deny', !legal && !!dragUid);
      };
      el.ondragleave = () => { el.classList.remove('drag-over', 'drag-deny'); };
      el.ondrop = (ev) => { ev.preventDefault(); el.classList.remove('drag-over', 'drag-deny'); dropOn(v, s); };
      box.appendChild(el);
    }
  }

  const hand = $('hand');
  hand.innerHTML = '';
  hand.classList.toggle('drag-active', !!dragUid); // 拖起时把手上其余卡调暗，突出正在拖的这张
  me.hand.forEach((h) => {
    const card = CARD_INDEX[h.cardId];
    const cost = effCost(ST, me, card);
    const playable = myTurn && cost <= me.mana && !ST.over;
    const el = document.createElement('div');
    // render() 会在拖拽中途被重新调用（高亮可放置位），重建的卡要延续 dragging 视觉，否则源卡会"闪回"原样
    el.className = `card r-${card.rarity} ${playable ? '' : 'disabled'} ${selected?.uid === h.uid ? 'selected' : ''} ${dragUid === h.uid ? 'dragging' : ''}`;
    // 对齐原作卡面：左上费用；助手卡左下生命 / 右下攻击；外援卡左下角类型图标
    const kind = card.type === 'companion' ? null : SPELL_KIND[card.subtype];
    el.innerHTML = `
      <div class="cost"><span>${cost}</span></div>
      <div class="ribbon ${card.type === 'companion' ? '' : 'spell'}">${card.type === 'companion' ? '助手' : '外援'}</div>
      <img src="assets/art/cards/${card.id}.svg" alt="">
      <div class="c-name">${card.name}</div>
      <div class="c-text">${card.text || ''}</div>
      ${card.type === 'companion'
        ? `<div class="c-hp" title="生命">${card.hp}</div><div class="c-atk" title="攻击">${card.atk}</div>`
        : `<div class="c-kind" style="border-color:${kind.color}" title="${kind.name}">${kind.icon}</div>`}`;
    el.onclick = () => onCardClick(h.uid);
    attachTip(el, () => cardTipHtml(card, card.type === 'companion' ? '' : ''));
    el.draggable = playable;
    el.ondragstart = (ev) => {
      hideTip();
      dragUid = h.uid;
      ev.dataTransfer.setData('text/plain', h.uid);
      ev.dataTransfer.effectAllowed = 'move';
      selected = { uid: h.uid, cardId: h.cardId, mode: 'card' };
      el.classList.add('dragging'); // 立即变暗缩小，不等 render 的下一拍
      setTimeout(() => render(), 0); // 拖起时高亮可放置/可选目标
    };
    el.ondragend = () => {
      dragUid = null; selected = null;
      document.querySelectorAll('.drag-over, .drag-deny').forEach((x) => x.classList.remove('drag-over', 'drag-deny'));
      render();
    };
    hand.appendChild(el);
  });

  const mana = $('mana');
  mana.innerHTML = '';
  for (let i = 0; i < 10; i++) mana.innerHTML += `<i class="${i < Math.min(10, me.mana) ? 'on' : ''}"></i>`;
  $('manaText').textContent = `${me.mana} / ${me.manaMax}`;

  const mf = $('manaFoe');
  mf.innerHTML = '';
  for (let i = 0; i < 10; i++) mf.innerHTML += `<i class="${i < Math.min(10, foe.mana) ? 'on' : ''}"></i>`;

  $('btnEnd').disabled = busy || !myTurn || ST.over;
  updateHighlights();
  applyFx(); // render 会重建卡位 DOM，这里把战斗中的高亮/聚焦重新贴回去
}

function updateHighlights() {
  document.querySelectorAll('.slot').forEach((el) => {
    el.classList.remove('can-drop', 'targetable', 'ally-target');
  });
  if (!selected || ST.current !== mySide) return;
  const card = CARD_INDEX[selected.cardId];
  const me = ST.players[R(0)];
  const foe = ST.players[R(1)];
  if (selected.mode === 'skill') {
    for (let s = 0; s < 3; s++) if (foe.board[s] && !foe.board[s].dead) slotEl(1, s)?.classList.add('targetable');
    return;
  }
  if (card.type === 'companion') {
    for (let s = 0; s < 3; s++) if (!me.board[s]) slotEl(0, s)?.classList.add('can-drop');
  } else if (card.needTarget === 'enemyUnit') {
    for (let s = 0; s < 3; s++) if (foe.board[s] && !foe.board[s].dead) slotEl(1, s)?.classList.add('targetable');
  } else if (card.needTarget === 'allyUnit') {
    for (let s = 0; s < 3; s++) if (me.board[s] && !me.board[s].dead) slotEl(0, s)?.classList.add('ally-target');
  }

  // 己方残骸：可花 1 梦力扫除（腾出卡位）
  if (me.mana >= 1) {
    for (let s = 0; s < 3; s++) if (me.board[s] && me.board[s].dead) slotEl(0, s)?.classList.add('clearable');
  }
}

const slotEl = (v, slot) => document.querySelector(`.slot[data-v="${v}"][data-slot="${slot}"]`);

// ────────────── 交互 ──────────────
function onCardClick(uid) {
  if (busy || ST.current !== mySide || ST.over) return;
  const me = ST.players[R(0)];
  const h = me.hand.find((x) => x.uid === uid);
  if (!h) return;
  const card = CARD_INDEX[h.cardId];
  if (effCost(ST, me, card) > me.mana) return hint('梦力不足');
  if (selected?.uid === uid) {
    if (card.type === 'spell' && !card.needTarget) return submit({ act: 'PLAY_CARD', uid });
    selected = null; hint('已取消'); return render();
  }
  selected = { uid, cardId: h.cardId, mode: 'card' };
  if (card.type === 'companion') hint('选择一个己方空位放置');
  else if (card.needTarget === 'enemyUnit') hint('选择一个敌方助手');
  else if (card.needTarget === 'allyUnit') hint('选择一个我方助手');
  else hint('再次点击这张卡施放');
  render();
}

function onSlotClick(v, slot) {
  if (busy || ST.current !== mySide || ST.over) return;
  const me = ST.players[R(0)];

  // 点击己方残骸 → 花 1 梦力扫除，腾出卡位
  if (v === 0 && me.board[slot] && me.board[slot].dead) {
    if (me.mana < 1) return hint('梦力不足，无法扫除残骸');
    if (selected) { selected = null; }
    return submit({ act: 'CLEAR_SLOT', slot });
  }

  if (!selected) return;
  const card = CARD_INDEX[selected.cardId];
  if (selected.mode === 'card') {
    if (card.type === 'companion') {
      if (v !== 0 || ST.players[R(0)].board[slot]) return;
      submit({ act: 'PLAY_CARD', uid: selected.uid, slot });
    } else if (card.needTarget === 'enemyUnit') {
      if (v !== 1 || !ST.players[R(1)].board[slot]) return;
      submit({ act: 'PLAY_CARD', uid: selected.uid, target: { side: 1, slot } });
    } else if (card.needTarget === 'allyUnit') {
      if (v !== 0 || !ST.players[R(0)].board[slot]) return;
      submit({ act: 'PLAY_CARD', uid: selected.uid, target: { side: 0, slot } });
    }
  } else if (selected.mode === 'skill') {
    if (v !== 1 || !ST.players[R(1)].board[slot]) return;
    submit({ act: 'USE_SKILL', skill: selected.skill, target: { side: 1, slot } });
  }
}

/** 拖拽落到具体卡位：助手卡放空位；奇遇卡按目标类型判定；己方残骸拖上来即扫除 */
function dropOn(v, slot) {
  const uid = dragUid;
  if (!uid || busy || ST.current !== mySide || ST.over) return;
  const me = ST.players[R(0)];
  const h = me.hand.find((x) => x.uid === uid);
  if (!h) return;
  const card = CARD_INDEX[h.cardId];
  if (effCost(ST, me, card) > me.mana) return hint('梦力不足');

  if (v === 0 && me.board[slot] && me.board[slot].dead) {
    dragUid = null;
    return submit({ act: 'CLEAR_SLOT', slot });
  }
  if (card.type === 'companion') {
    if (v === 0 && !me.board[slot]) { dragUid = null; return submit({ act: 'PLAY_CARD', uid, slot }); }
    return hint('助手卡只能放到自己的空卡位');
  }
  if (card.needTarget === 'enemyUnit') {
    const t = ST.players[R(1)].board[slot];
    if (v === 1 && t && !t.dead) { dragUid = null; return submit({ act: 'PLAY_CARD', uid, target: { side: 1, slot } }); }
    return hint('这张奇遇卡要拖到敌方助手上');
  }
  if (card.needTarget === 'allyUnit') {
    const t = me.board[slot];
    if (v === 0 && t && !t.dead) { dragUid = null; return submit({ act: 'PLAY_CARD', uid, target: { side: 0, slot } }); }
    return hint('这张奇遇卡要拖到我方助手上');
  }
  dragUid = null;
  submit({ act: 'PLAY_CARD', uid });
}

/** 拖拽落到战场（卡位附近松手）：一次性奇遇卡直接生效 */
function dropOnField() {
  const uid = dragUid;
  if (!uid || busy || ST.current !== mySide || ST.over) return;
  const me = ST.players[R(0)];
  const h = me.hand.find((x) => x.uid === uid);
  if (!h) return;
  const card = CARD_INDEX[h.cardId];
  if (card.type === 'companion') return hint('助手卡要放到自己的空卡位上');
  if (card.needTarget) return hint('这张奇遇卡需要指定目标，拖到目标助手上');
  if (effCost(ST, me, card) > me.mana) return hint('梦力不足');
  dragUid = null;
  submit({ act: 'PLAY_CARD', uid });
}

function trySkill(key) {
  const sk = PARTNERS[ST.players[R(0)].partnerId].skills[key];
  if (sk.op === 'dmgOne') {
    selected = { mode: 'skill', skill: key, cardId: 'c15' };
    hint('选择一个敌方助手');
    return render();
  }
  submit({ act: 'USE_SKILL', skill: key });
}

/** 视图 side → 真实 side 后提交 */
function toReal(action) {
  const a = { ...action };
  if (a.target) a.target = { side: R(a.target.side), slot: a.target.slot };
  return a;
}

async function submit(action) {
  const real = toReal(action);
  if (mode === 'online') {
    net.send(real).then((r) => { if (!r.ok) hint(r.msg || '操作失败'); });
    selected = null; hint('');
    return;
  }
  const r = applyAction(ST, real);
  if (!r.ok) return hint('该操作不合法');
  ST = r.state;
  selected = null;
  hint('');
  render();
  busy = true;
  await playEvents(r.events);
  busy = false;
  render();
  checkOver();
}

async function endTurn() {
  if (busy || ST.current !== mySide || ST.over) return;
  if (mode === 'online') {
    selected = null; hint('等待对手…');
    net.send({ act: 'END_TURN' }).then((r) => { if (!r.ok) hint(r.msg || '操作失败'); });
    return;
  }
  busy = true;
  const r = applyAction(ST, { act: 'END_TURN' });
  ST = r.state;
  selected = null;
  render();
  await playEvents(r.events);
  if (checkOver()) { busy = false; render(); return; }
  await sleep(700);
  await aiTurn();
}

async function aiTurn() {
  busy = true;
  let guard = 0;
  while (!ST.over && ST.current === R(1) && guard++ < 60) {
    const action = chooseAction(ST, R(1), diff);
    const r = applyAction(ST, action);
    if (!r.ok) break;
    ST = r.state;
    render();
    await playEvents(r.events);   // AI 的出牌/攻击同样走动画状态机
    if (action.act === 'END_TURN') break;
    await sleep(600);             // AI 每步之间的停顿，方便看清它在做什么
  }
  if (!ST.over && ST.current === R(1)) {
    const r = applyAction(ST, { act: 'END_TURN' });
    ST = r.state; render(); await playEvents(r.events);
  }
  busy = false;
  render();
  checkOver();
}

// ────────────── 日志 / 飘字 ──────────────
// 战斗日志已从界面移除（改为纯动画反馈），保留函数以防调用处遗漏
function log(_text) { /* no-op */ }
function hint(t) { $('hint').textContent = t; }

/* ═══════════ 攻击动画状态机 ═══════════
   一次攻击的展示序列：
     ① 攻击方晃动（出招）
     ② 被攻击对象红色描边高亮 + 显示攻击数值（飘字持续 3s）
     ③ 被攻击对象受伤晃动
     ④ 死亡则播放破碎动画，随后刷新为残骸；否则只是扣血
*/
/**
 * 动画节奏（毫秒）。之前太快看不清，已整体放慢约 2.5 倍。
 * 一次攻击的完整序列 ≈ attack + hit + hurt = 2.2 秒，外加数值飘字停留 3 秒。
 * 想再快/再慢，直接改这里的数值即可（或在设置里加倍速）。
 */
const ANIM = {
  hold: 800,   // ① 攻击方(黄) 与 被攻击方(红) 同时高亮
  hurt: 650,   // ②-a 被攻击方抖动 + 头顶飘出扣血量（血条仍是旧值）
  settle: 350, // ②-b 血条跟随下降到新值
  death: 900,  // ③ 死亡破碎
  step: 400,
};

/* ── 悬浮信息卡：显示血量 / 攻击 / 卡牌效果 ── */
let tipEl = null;
function hideTip() {
  if (tipEl) { tipEl.remove(); tipEl = null; }
}
function attachTip(el, buildHtml) {
  if (!el) return;
  el.addEventListener('mouseenter', () => {
    hideTip();
    const t = document.createElement('div');
    t.className = 'tip';
    t.innerHTML = buildHtml();
    document.body.appendChild(t);
    tipEl = t;
    const r = el.getBoundingClientRect();
    const th = t.offsetHeight || 120;
    // 默认显示在上方，空间不够则放下方
    const top = r.top - th - 8 >= 8 ? r.top - th - 8 : r.bottom + 8;
    t.style.top = `${Math.max(8, top)}px`;
    t.style.left = `${Math.min(window.innerWidth - 226, Math.max(8, r.left + r.width / 2 - 108))}px`;
  });
  el.addEventListener('mouseleave', hideTip);
}

/** 助手卡/奇遇卡的通用信息 HTML */
function cardTipHtml(card, extra = '') {
  const f = FACTION_META[card.faction];
  const rn = { common: '普通', rare: '稀有', epic: '史诗', legend: '传说' }[card.rarity] || '';
  const kind = card.type === 'companion' ? '助手卡' : `奇遇卡 · ${(SPELL_KIND[card.subtype] || {}).name || ''}`;
  const stat = card.type === 'companion'
    ? `<div class="t-stat">生命 ${card.hp} &nbsp; 攻击 ${card.atk}</div>`
    : '';
  return `<div class="t-name">${card.name}</div>
    <div class="t-meta">${f.icon} ${f.name} · ${rn} · ${card.cost} 梦力 · ${kind}</div>
    ${stat}
    ${card.text ? `<div class="t-text">${card.text}</div>` : ''}
    ${extra}`;
}

/** 场上单位的信息（含当前血量与状态） */
function unitTipHtml(u) {
  const card = CARD_INDEX[u.cardId];
  if (!card) return `<div class="t-name">${u.name}</div>`;
  const tags = [];
  if (u.taunt) tags.push('<span class="t-tag">嘲讽</span>');
  if (u.firstStrike) tags.push('<span class="t-tag">先伤</span>');
  if (u.doubleOnce && !u.doubleUsed) tags.push('<span class="t-tag">连击</span>');
  if (u.dead) tags.push('<span class="t-tag">残骸 · 花 1 梦力扫除</span>');
  if (u.skipNext) tags.push('<span class="t-tag">被控制</span>');
  const stat = u.dead
    ? `<div class="t-stat">已阵亡（残骸）</div>`
    : `<div class="t-stat">生命 ${u.hp}/${u.maxHp} &nbsp; 攻击 ${u.atk}</div>`;
  return `<div class="t-name">${u.name}</div>
    <div class="t-meta">${(FACTION_META[card.faction] || {}).name || ''} · ${card.cost} 梦力</div>
    ${stat}
    <div>${tags.join('')}</div>
    ${card.text ? `<div class="t-text">${card.text}</div>` : ''}`;
}

/** 奇遇卡释放：中央显示卡面影像，5 秒渐渐消散 */
function showSpellCast(card) {
  const el = document.createElement('div');
  el.className = 'spell-cast';
  el.innerHTML = `<img src="assets/art/cards/${card.id}.svg" alt="">
    <div class="sc-name">${card.name}</div>
    <div class="sc-text">${card.text || ''}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function unitEl(v, slot) { return document.getElementById(`u-${v}-${slot}`); }
function partnerEl(v) { return document.getElementById(`partnerArt${v}`)?.parentElement; }

/** 高亮被攻击目标：to.slot >= 0 → 该助手位；否则 → 对方伙伴框 */
function highlightTarget(to, ms) {
  if (!to) return;
  const v = V(to.side);
  const el = to.slot >= 0 ? unitEl(v, to.slot) : partnerEl(v);
  addClass(el, 'hit', ms);
}

function addClass(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if (ms) setTimeout(() => el.classList.remove(cls), ms);
}

/** 飘字：数值停留 3s（CSS 动画时长），不阻塞后续步骤 */
function showNum(el, text, cls) {
  if (!el) return;
  const n = document.createElement('div');
  n.className = `dmg-num ${cls}`;
  n.textContent = text;
  el.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

/* ═══════════ 攻击特效：箭头 + 序号 + 冲刺 + 聚焦变暗 ═══════════
   原版《奥比岛·偶像之战》的战斗表现是「进攻方冲向目标 + 攻击线 + 受击方抖动 + 飘伤害数字」。
   之前只有「双方同时描边」，完全看不出谁打谁，这里补齐：
     ① 攻击方向目标方向【冲刺】一下
     ② 画一条【金色箭头】从攻击方指向受击方，中间带【序号徽章】①②③
     ③ 没参与本次攻击的卡/角色【压暗】，只突出这两个
     ④ 提示条写出具体名字：「白兔先生 → 胆小狮」
*/
const SVGNS = 'http://www.w3.org/2000/svg';
let atkSeq = 0;

function fxClear() {
  const s = $('fx');
  if (s) s.innerHTML = '';
}

/** 单位/角色的显示名（slot < 0 表示打的是角色本体） */
function nameOf(v, slot) {
  const p = ST.players[R(v)];
  if (slot < 0) return PARTNERS[p.partnerId].name;
  const u = p.board[slot];
  return u ? u.name : '空位';
}

/* ── 战斗高亮/聚焦用「状态」驱动：render() 会重建卡位 DOM，直接加 class 会被冲掉 ──
   key 规则：助手位 = `${v}:${slot}`，角色框 = `p${v}` */
const fxState = { atk: new Set(), hit: new Set(), dim: new Set() };

const allFxKeys = () => {
  const out = [];
  for (const v of [0, 1]) {
    for (let s = 0; s < 3; s++) out.push(`${v}:${s}`);
    out.push(`p${v}`);
  }
  return out;
};
function elFromKey(k) {
  if (!k) return null;
  if (k[0] === 'p') return partnerEl(Number(k.slice(1)));
  const [v, s] = k.split(':').map(Number);
  return unitEl(v, s);
}

/** 设置本次攻击的「攻击方 / 受击方」，其余自动压暗 */
function setFx(atkKeys, hitKeys) {
  fxState.atk = new Set(atkKeys.filter(Boolean));
  fxState.hit = new Set(hitKeys.filter(Boolean));
  fxState.dim = new Set(allFxKeys().filter((k) => !fxState.atk.has(k) && !fxState.hit.has(k)));
  applyFx();
}
function applyFx() {
  for (const k of allFxKeys()) {
    const el = elFromKey(k);
    if (!el) continue;
    el.classList.toggle('attacking', fxState.atk.has(k));
    el.classList.toggle('hit', fxState.hit.has(k));
    el.classList.toggle('dim', fxState.dim.has(k));
  }
}
function clearFx() {
  fxState.atk.clear();
  fxState.hit.clear();
  fxState.dim.clear();
  applyFx();
}

/** 画「攻击方 → 受击方」的箭头 + 序号徽章 */
function fxArrow(fromEl, toEl, seq) {
  const svg = $('fx');
  if (!svg || !fromEl || !toEl) return;
  fxClear(); // 同时只保留当前这一次攻击的箭头
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
  const x2 = b.left + b.width / 2, y2 = b.top + b.height / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len;
  const pad = 30; // 两端留白，别压住卡面
  const sx = x1 + ux * pad, sy = y1 + uy * pad;
  const ex = x2 - ux * pad, ey = y2 - uy * pad;

  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'fx-wrap');

  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', sx); line.setAttribute('y1', sy);
  line.setAttribute('x2', ex); line.setAttribute('y2', ey);
  line.setAttribute('class', 'fx-arrow-line');
  g.appendChild(line);

  // 箭头头部（三角形）
  const hs = 14, px = -uy, py = ux;
  const head = document.createElementNS(SVGNS, 'polygon');
  head.setAttribute('points',
    `${ex},${ey} ${ex - ux * hs + px * hs * 0.55},${ey - uy * hs + py * hs * 0.55} ${ex - ux * hs - px * hs * 0.55},${ey - uy * hs - py * hs * 0.55}`);
  head.setAttribute('class', 'fx-arrow-head');
  g.appendChild(head);

  // 序号徽章（①②③）
  if (seq > 0) {
    const mx = (sx + ex) / 2, my = (sy + ey) / 2;
    const bg = document.createElementNS(SVGNS, 'circle');
    bg.setAttribute('cx', mx); bg.setAttribute('cy', my); bg.setAttribute('r', 12);
    bg.setAttribute('class', 'fx-seq-bg');
    const tx = document.createElementNS(SVGNS, 'text');
    tx.setAttribute('x', mx); tx.setAttribute('y', my);
    tx.setAttribute('class', 'fx-seq');
    tx.textContent = String(seq);
    g.appendChild(bg);
    g.appendChild(tx);
  }

  svg.appendChild(g);
  setTimeout(() => g.remove(), 1900);
}

async function playEvents(events) {
  if (!events || !events.length) return;
  atkSeq = 0;
  for (const e of events) {
    switch (e.e) {
      case 'PLAY': {
        // 奇遇卡释放：中央卡面影像，5 秒渐渐消散
        const c = CARD_INDEX[e.card];
        if (c && c.type === 'spell') showSpellCast(c);
        await sleep(ANIM.step);
        break;
      }
      case 'ATTACK': {
        const fv = V(e.from.side);
        const tv = V(e.to.side);
        const fromEl = unitEl(fv, e.from.slot);
        const toEl = e.to.slot >= 0 ? unitEl(tv, e.to.slot) : partnerEl(tv);
        atkSeq++;
        hint(`① 卡牌攻击 ${atkSeq} · ${nameOf(fv, e.from.slot)} → ${nameOf(tv, e.to.slot)}`);
        setFx([`${fv}:${e.from.slot}`], [e.to.slot >= 0 ? `${tv}:${e.to.slot}` : `p${tv}`]);
        addClass(fromEl, fv === 0 ? 'dash-right' : 'dash-left', 460); // 我方在左列 → 向右撞
        fxArrow(fromEl, toEl, atkSeq);
        await sleep(ANIM.hold);
        break;
      }
      case 'HERO_ATTACK': {
        const fv = V(e.from.side);
        const tv = V(e.to.side);
        const fromEl = partnerEl(fv);
        const toEl = e.to.slot >= 0 ? unitEl(tv, e.to.slot) : partnerEl(tv);
        atkSeq++;
        hint(`② 角色攻击 · ${nameOf(fv, -1)} → ${nameOf(tv, e.to.slot)}`);
        setFx([`p${fv}`], [e.to.slot >= 0 ? `${tv}:${e.to.slot}` : `p${tv}`]);
        addClass(fromEl, fv === 0 ? 'dash-right' : 'dash-left', 460);
        fxArrow(fromEl, toEl, atkSeq);
        await sleep(ANIM.hold);
        break;
      }
      case 'DMG_UNIT': {
        // ②-a 先抖动 + 头顶飘出被扣血量（此时血条仍是旧值，看清"打了多少"）
        const v = V(e.side);
        const el = unitEl(v, e.slot);
        const uk = unitKey(v, e.slot);
        hpOverride.set(uk, e.hpBefore ?? (e.hp + e.value));  // 冻结旧血量
        aliveOverride.add(uk);                               // 暂不显示"残骸"
        render();
        addClass(el, 'hurt', ANIM.hurt + ANIM.settle + 60);
        showNum(el, `-${e.value}`, 'n-dmg');
        await sleep(ANIM.hurt);
        // ②-b 再解除冻结，血条跟着降到新值
        hpOverride.delete(uk);
        render();
        await sleep(ANIM.settle);
        break;
      }
      case 'DMG_HERO': {
        const v = V(e.side);
        const el = partnerEl(v);
        const hk = heroKey(v);
        hpOverride.set(hk, e.hpBefore ?? (e.hp + e.value));
        render();
        addClass(el, 'hurt', ANIM.hurt + ANIM.settle + 60);
        showNum(el, `-${e.value}`, 'n-dmg');
        await sleep(ANIM.hurt);
        hpOverride.delete(hk);
        render();
        await sleep(ANIM.settle);
        break;
      }
      case 'HEAL_HERO': {
        if (e.value) showNum(partnerEl(V(e.side)), `+${e.value}`, 'n-heal');
        await sleep(ANIM.step);
        break;
      }
      case 'DEATH': {
        const v = V(e.side);
        const el = unitEl(v, e.slot);
        aliveOverride.delete(unitKey(v, e.slot));             // 血条已降完 → 正式变残骸
        addClass(el, 'dying', ANIM.death);                    // ④ 死亡破碎
        await sleep(ANIM.death);
        render();
        await sleep(ANIM.step);
        break;
      }
      case 'CLEAR':
        render();
        await sleep(ANIM.step);
        break;
      case 'SUMMON':
      case 'TRANSFORM':
      case 'SKILL':
        await sleep(ANIM.step);
        break;
      default:
        break;
    }
  }
  hint('');
  clearAnimOverride();
  clearFx();
  fxClear();
  render();
}


/** 攻击抖动：给单位/伙伴框加动画类，动画结束自动移除 */
function playShake(el) {
  if (!el) return;
  el.classList.remove('attacking');
  void el.offsetWidth; // 强制重排，保证连续攻击能重复触发动画
  el.classList.add('attacking');
  setTimeout(() => el.classList.remove('attacking'), 400);
}
function shakeUnit(v, slot) {
  playShake(document.getElementById(`u-${v}-${slot}`));
}
function shakePartner(v) {
  playShake(document.getElementById(`partnerArt${v}`)?.parentElement);
}

function float(realSide, slot, text, cls) {
  const el = document.getElementById(`u-${V(realSide)}-${slot}`);
  if (!el) return;
  const f = document.createElement('div');
  f.className = `float ${cls}`;
  f.textContent = text;
  f.style.left = '50%'; f.style.top = '10px';
  el.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

function floatHero(realSide, text, cls) {
  const el = $(`partnerArt${V(realSide)}`).parentElement;
  const f = document.createElement('div');
  f.className = `float ${cls}`;
  f.textContent = text;
  f.style.left = '40px'; f.style.top = '10px';
  el.style.position = 'relative';
  el.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

function checkOver() {
  if (!ST || !ST.over) return false;
  const myWin = ST.winner === mySide;
  const title = ST.winner === -1 ? '🤝 平局' : myWin ? '🎉 你赢了！' : '💀 你输了';
  $('ovTitle').textContent = title;
  $('ovText').textContent = `共 ${ST.turn} 回合（每人约 ${Math.ceil(ST.turn / 2)} 回合）${mode === 'online' ? ' · 房间 ' + net.roomId : ''}`;
  $('overlay').classList.remove('hidden');
  document.querySelectorAll('.spell-cast').forEach((el) => el.remove()); // 清掉可能还没消散的奇遇卡展示，避免挡住结算面板
  log(`对局结束：${title}`);
  return true;
}

initSelects();
initHome({ onStart: handleStart });
showHome();

/** 主页「开始」回调：带上主页选好的伙伴与 6+2 卡组 */
async function handleStart({ partnerId, deck, kind, roomId, level: lv, diff: df }) {
  currentPartner = partnerId;
  currentDeck = deck;
  if (lv) level = Number(lv);
  if (df) { diff = df; $('selDiff').value = df; }
  showGame();
  if (kind === 'ai') {
    mode = 'ai';
    mySide = 0;
    view = [0, 1];
    return newGame();
  }
  if (kind === 'create') return createRoom();
  if (kind === 'join') {
    $('roomInput').value = roomId || '';
    return joinRoom();
  }
}
