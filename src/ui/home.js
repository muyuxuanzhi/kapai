// 个人主页：切换伙伴（皮肤形态）+ 编卡（6 张助手卡 + 2 张奇遇卡）
// 只有已解锁（starter 初始 / quest 主线）的卡可以编入卡组

import { CARDS, CARD_INDEX, FACTION_META, SPELL_KIND } from '../data/cards.js';
import { PARTNERS, PARTNER_LIST, partnerStats, skillDescription } from '../data/partners.js';
import { DECKS, DECK_SIZE, resonanceOf, BLESSING_TEXT } from '../data/decks.js';

const $ = (id) => document.getElementById(id);
const UNLOCKED = new Set(['starter', 'quest']); // 试玩阶段：初始 + 主线解锁可编入

export function initHome({ onStart }) {
  let partnerId = 'hood';
  let deck = { companion: [], spell: [] }; // 存 cardId
  let tab = 'companion';
  let page = 0;
  let draggedCard = null;
  const pageSize = 10;
  const unlocked = c => UNLOCKED.has(c.acquire) || DECKS.starter.cards.includes(c.id);
  const selectedLevel = () => Number($('selLevelHome').value);
  const inspect = c => { $('cardInspect').textContent = `${c.name} · ${c.cost} 梦力 · ${c.text || '无特殊能力'}`; };
  const bindDrag = (el, c) => {
    el.draggable = unlocked(c);
    el.ondragstart = ev => {
      draggedCard = c.id;
      ev.dataTransfer.setData('text/plain', c.id);
      ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('deck-dragging');
    };
    el.ondragend = () => {
      draggedCard = null;
      document.querySelectorAll('.deck-dragging, .deck-over').forEach(x => x.classList.remove('deck-dragging', 'deck-over'));
    };
    el.onmouseenter = () => inspect(c);
    el.onfocus = () => inspect(c);
    el.tabIndex = 0;
  };

  // 默认载入初始卡组
  loadDeck(DECKS.starter.cards);

  function loadDeck(ids) {
    deck.companion = [];
    deck.spell = [];
    for (const id of ids) {
      const c = CARD_INDEX[id];
      if (!c) continue;
      if (c.type === 'companion' && deck.companion.length < DECK_SIZE.companion) deck.companion.push(id);
      else if (c.type === 'spell' && deck.spell.length < DECK_SIZE.spell) deck.spell.push(id);
    }
  }

  function deckIds() { return [...deck.companion, ...deck.spell]; }

  // ── 伙伴选择 ──
  function renderPartners() {
    $('partnerList').innerHTML = PARTNER_LIST.map((p) => `
      <div class="p-card ${p.id === partnerId ? 'on' : ''}" data-id="${p.id}">
        <img src="${p.art}" alt="">
        <div class="pc-name">${p.name}</div>
        <div class="pc-tag">${p.quality} 级 · ${p.title}</div>
      </div>`).join('');
    document.querySelectorAll('#partnerList .p-card').forEach((el) => {
      el.onclick = () => { partnerId = el.dataset.id; renderPartners(); };
    });

    // 左侧光环展示台：大图预览当前选中伙伴
    const prev = $('partnerPreview');
    if (prev) prev.src = PARTNERS[partnerId].art;

    const p = PARTNERS[partnerId];
    const lv = selectedLevel();
    const stats = partnerStats(partnerId, lv);
    const line = (key, kind) => {
      const s = p.skills[key];
      return `<div class="pd-skill"><b>${kind}</b> ${s.name}` +
        (s.cost ? ` <span class="pd-cost">${s.cost}梦力 · CD${s.cd}</span>` : '') +
        `<div class="pd-desc">${skillDescription(p, key, lv)}${lv < s.unlock ? `（Lv${s.unlock} 解锁）` : ''}</div></div>`;
    };
    $('partnerDetail').innerHTML = `
      <div class="pd-title">${p.name} · ${p.title} <span class="pd-q">${p.quality} 级</span></div>
      <div class="pd-stats">Lv${lv} · 生命 ${stats.hp} · 攻击 ${stats.atk}</div>
      ${line('active', '主动')}${line('passive', '被动')}${line('ultimate', '终极')}`;
    $('lobbyArt').src = p.art;
    $('lobbyName').textContent = `${p.name} · ${p.title}`;
  }

  // ── 已编入的卡组 ──
  function renderDeckSlots() {
    const fill = (box, arr, max, type) => {
      box.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const id = arr[i];
        const el = document.createElement('div');
        if (id) {
          const c = CARD_INDEX[id];
          el.className = `mini-card r-${c.rarity}`;
          const kd = c.type === 'companion' ? null : SPELL_KIND[c.subtype];
          el.innerHTML = `<div class="ribbon mini ${c.type === 'companion' ? '' : 'spell'}">${c.type === 'companion' ? '助手' : '外援'}</div>
            <img src="assets/art/cards/${id}.svg" alt="">
            <div class="mc-name">${c.name}</div>
            <div class="mc-cost" data-v="${c.cost}"></div>
            ${c.type === 'companion'
              ? `<div class="mc-hp">${c.hp}</div><div class="mc-atk">${c.atk}</div>`
              : `<div class="mc-kind" title="${kd.name}">${kd.icon}</div>`}`;
          el.title = `${c.name}：${c.text || '无特殊能力'}；点击移除，拖动重排`;
          bindDrag(el, c);
          el.onclick = () => { arr.splice(i, 1); renderHome(); };
        } else {
          el.className = 'mini-card empty';
          el.innerHTML = `<div>＋</div><div class="mc-tip">${type === 'companion' ? '助手' : '奇遇'}</div>`;
        }
        el.dataset.type = type;
        el.dataset.index = i;
        el.ondragover = ev => {
          ev.preventDefault();
          const valid = CARD_INDEX[draggedCard]?.type === type;
          ev.dataTransfer.dropEffect = valid ? 'move' : 'none';
          el.classList.toggle('deck-over', valid);
        };
        el.ondragleave = () => el.classList.remove('deck-over');
        el.ondrop = ev => {
          ev.preventDefault();
          ev.stopPropagation();
          el.classList.remove('deck-over');
          const c = CARD_INDEX[draggedCard];
          draggedCard = null;
          if (!c || !unlocked(c) || c.type !== type) return flash('只能拖入已解锁的同类卡牌');
          const from = arr.indexOf(c.id);
          if (from === i) return;
          if (from >= 0) {
            if (arr[i]) [arr[from], arr[i]] = [arr[i], arr[from]];
            else { arr.splice(from, 1); arr.push(c.id); }
          } else if (i < arr.length) arr[i] = c.id;
          else if (arr.length < max) arr.push(c.id);
          renderHome();
        };
        box.appendChild(el);
      }
    };
    fill($('deckCompanions'), deck.companion, DECK_SIZE.companion, 'companion');
    fill($('deckSpells'), deck.spell, DECK_SIZE.spell, 'spell');
    $('cntCompanion').textContent = `${deck.companion.length}/${DECK_SIZE.companion}`;
    $('cntSpell').textContent = `${deck.spell.length}/${DECK_SIZE.spell}`;

    const b = resonanceOf(deckIds(), CARD_INDEX);
    $('resonanceInfo').innerHTML = b
      ? `<span class="res-on">✨ 故事共鸣已激活：${BLESSING_TEXT[b]}</span>`
      : `<span class="res-off">未触发故事共鸣（同阵营助手卡需 ≥3 张，当前每阵营最多 ${maxFaction()} 张）</span>`;
  }

  function maxFaction() {
    const count = { wonder: 0, forest: 0, oz: 0 };
    for (const id of deck.companion) count[CARD_INDEX[id].faction]++;
    return Math.max(count.wonder, count.forest, count.oz);
  }

  // ── 卡库 ──
  function renderLibrary() {
    const box = $('cardLibrary');
    box.innerHTML = '';
    const query = $('filterCard').value.trim();
    const faction = $('filterFaction').value;
    const cards = CARDS.filter(c => c.type === tab && (faction === 'all' || c.faction === faction) && (!query || (c.name + c.text).includes(query)));
    const pages = Math.max(1, Math.ceil(cards.length / pageSize));
    page = Math.min(page, pages - 1);
    $('libraryPage').textContent = `${page + 1} / ${pages} · ${cards.length} 张`;
    $('pagePrev').disabled = page === 0;
    $('pageNext').disabled = page === pages - 1;
    if (!cards.length) box.textContent = '没有符合筛选条件的卡牌';
    cards.slice(page * pageSize, (page + 1) * pageSize).forEach((c) => {
      const available = unlocked(c);
      const picked = deck[c.type].includes(c.id);
      const el = document.createElement('div');
      el.className = `lib-card r-${c.rarity} ${available ? '' : 'locked'} ${picked ? 'picked' : ''}`;
      el.dataset.cardId = c.id;
      el.title = `${c.name}：${c.text || '无特殊能力'}`;
      bindDrag(el, c);
      const f = FACTION_META[c.faction];
      el.innerHTML = `
        <div class="ribbon mini ${c.type === 'companion' ? '' : 'spell'}">${c.type === 'companion' ? '助手' : '外援'}</div>
        <img src="assets/art/cards/${c.id}.svg" alt="">
        <div class="lc-name">${c.name}</div>
        <div class="lc-meta">${f.icon}${f.name} · ${c.cost}费</div>
        <div class="lc-text">${c.text || ''}</div>
        ${c.type === 'companion'
          ? `<div class="lc-hp">${c.hp}</div><div class="lc-atk">${c.atk}</div>`
          : `<div class="lc-kind" title="${(SPELL_KIND[c.subtype] || {}).name}">${(SPELL_KIND[c.subtype] || {}).icon}</div>`}
        ${available ? '' : `<div class="lc-lock">${c.acquire === 'gacha' ? '抽卡解锁' : '合成解锁'}</div>`}`;
      if (available) el.onclick = () => toggleCard(c);
      box.appendChild(el);
    });
  }

  function toggleCard(c) {
    const arr = deck[c.type];
    const idx = arr.indexOf(c.id);
    if (idx >= 0) arr.splice(idx, 1);
    else {
      if (arr.length >= DECK_SIZE[c.type]) {
        const tip = c.type === 'companion' ? '助手卡最多 6 张' : '奇遇卡最多 2 张';
        flash(tip);
        return;
      }
      arr.push(c.id);
    }
    renderHome();
  }

  let tipTimer = null;
  function flash(msg) {
    const el = $('resonanceInfo');
    el.innerHTML = `<span class="res-warn">${msg}</span>`;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(renderHome, 1600);
  }

  function renderBattleTab() {
    const box = $('lobbyDeck');
    if (!box) return;
    box.innerHTML = '';
    const ids = deckIds();
    ids.forEach(id => {
      const c = CARD_INDEX[id];
      if (!c) return;
      const kd = c.type === 'companion' ? null : SPELL_KIND[c.subtype];
      const el = document.createElement('div');
      el.className = `mini-card r-${c.rarity}`;
      el.title = `${c.name}：${c.text || '无特殊能力'}`;
      el.innerHTML = `<div class="ribbon mini ${c.type === 'companion' ? '' : 'spell'}">${c.type === 'companion' ? '助手' : '外援'}</div>
        <img src="assets/art/cards/${id}.svg" alt="">
        <div class="mc-name">${c.name}</div>
        <div class="mc-cost" data-v="${c.cost}"></div>
        ${c.type === 'companion'
          ? `<div class="mc-hp">${c.hp}</div><div class="mc-atk">${c.atk}</div>`
          : `<div class="mc-kind" title="${kd.name}">${kd.icon}</div>`}`;
      box.appendChild(el);
    });
    const sum = $('lobbySummary');
    if (sum) {
      const b = resonanceOf(ids, CARD_INDEX);
      sum.innerHTML = b
        ? `✨ 故事共鸣已激活：${BLESSING_TEXT[b]}`
        : `无共鸣（同阵营助手卡需 ≥3 张）`;
    }
  }

  function renderHome() {
    renderPartners();
    renderDeckSlots();
    renderLibrary();
    renderBattleTab();
  }

  document.querySelectorAll('.lib-tabs button').forEach((b) => {
    b.onclick = () => {
      tab = b.dataset.tab;
      page = 0;
      document.querySelectorAll('.lib-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      renderLibrary();
    };
  });

  // 卡库筛选
  const filterCard = $('filterCard');
  const filterFaction = $('filterFaction');
  if (filterCard) filterCard.oninput = () => { page = 0; renderLibrary(); };
  if (filterFaction) filterFaction.onchange = () => { page = 0; renderLibrary(); };

  // 翻页
  const pagePrev = $('pagePrev');
  const pageNext = $('pageNext');
  if (pagePrev) pagePrev.onclick = () => { page--; renderLibrary(); };
  if (pageNext) pageNext.onclick = () => { page++; renderLibrary(); };

  // 恢复初始卡组
  const resetDeck = $('resetDeck');
  if (resetDeck) resetDeck.onclick = () => { loadDeck(DECKS.starter.cards); renderHome(); };

  // 战斗标签页里的「切换角色」→ 跳到偶像选择
  const editPartner = $('editPartner');
  if (editPartner) editPartner.onclick = () => showTab('partner');

  // 战斗标签页里的「编卡」→ 跳到编卡页
  const editDeck = $('editDeck');
  if (editDeck) editDeck.onclick = () => showTab('deck');

  // 等级切换：重新渲染伙伴面板
  const selLevelHome = $('selLevelHome');
  if (selLevelHome) selLevelHome.onchange = () => renderPartners();

  // 底部入口切换（对齐原作：偶像 / 编卡 / 召唤舞台 / 对战 / 任务成就 / 排行榜 / 好友）
  function showTab(go) {
    for (const t of ['partner', 'deck', 'summon', 'battle']) {
      const el = $('tab-' + t);
      if (el) el.classList.toggle('hidden', t !== go);
    }
    document.querySelectorAll('.home-nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === go));
  }
  document.querySelectorAll('.home-nav button').forEach((b) => {
    b.onclick = () => {
      if (b.classList.contains('soon')) return flash('「' + b.querySelector('span').textContent + '」开发中，敬请期待');
      showTab(b.dataset.go);
    };
  });

  const ready = () => deck.companion.length === DECK_SIZE.companion && deck.spell.length === DECK_SIZE.spell;
  const start = (kind, roomId) => {
    if (!ready()) {
      showTab('deck');
      flash(`还需编满：助手 ${deck.companion.length}/6，奇遇 ${deck.spell.length}/2`);
      return;
    }
    onStart({
      partnerId,
      deck: deckIds(),
      kind,
      roomId,
      level: Number($('selLevelHome')?.value || 10),
      diff: $('selDiffHome')?.value || 'normal',
    });
  };

  $('btnStartAi').onclick = () => start('ai');
  $('btnStartCreate').onclick = () => start('create');
  $('btnStartJoin').onclick = () => {
    const id = ($('homeRoomInput').value || '').trim().toUpperCase();
    if (!id) return flash('请输入房间码');
    start('join', id);
  };

  renderHome();
}

export function showHome() {
  $('home').classList.remove('hidden');
  $('game').classList.add('hidden');
}

export function showGame() {
  $('home').classList.add('hidden');
  $('game').classList.remove('hidden');
}
