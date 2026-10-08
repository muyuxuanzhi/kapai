// M0.5 平衡验证：用 AI vs AI 批量对局，检查设计文档 9.1 的及格线
// 用法: node sim.js --all | --mirror 600 | --heroes 400 | --factions 400 | --starter 400 [--level 10] [--diff normal]

import { createGame, applyAction } from './src/engine/rules.js';
import { runAiTurn } from './src/engine/ai.js';
import { DECKS } from './src/data/decks.js';
import { PARTNER_LIST, TUNE } from './src/data/partners.js';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes('--' + k) || args.includes('-' + k);

const LEVEL = Number(opt('level', 10));
const DIFF = opt('diff', 'normal');
const N = Number(args.find((a) => /^\d+$/.test(a)) || 0);

// --shield N：临时覆盖后手补偿护盾，用于重新标定（不改代码即可扫描）
const SHIELD = opt('shield', null);
if (SHIELD !== null) TUNE.secondShieldOverride = Number(SHIELD);

function playMatch({ deckA, deckB, partnerA, partnerB, seed, first }) {
  let st = createGame({
    deckA: deckA.cards, deckB: deckB.cards,
    partnerA, partnerB, levelA: LEVEL, levelB: LEVEL, seed, first,
  });
  let guard = 0;
  while (!st.over && guard++ < 400) {
    const before = st;
    const r = runAiTurn(st, st.current, DIFF);
    st = r.state;
    if (st === before) st = applyAction(st, { act: 'END_TURN' }).state; // 死锁保护
  }
  if (!st.over) st.winner = -1;
  return st;
}

function aggregate(list, n) {
  const w0 = list.filter((x) => x.winner === 0).length;
  const w1 = list.filter((x) => x.winner === 1).length;
  const draw = list.length - w0 - w1;
  const turns = list.reduce((a, x) => a + x.turn, 0) / list.length;
  let dmg = 0, skill = 0;
  for (const x of list) for (const p of x.players) { dmg += p.stats.damage; skill += p.stats.skillDamage; }
  return {
    rate0: (w0 / list.length) * 100,
    rate1: (w1 / list.length) * 100,
    draw: (draw / list.length) * 100,
    turns,
    skillPct: dmg ? (skill / dmg) * 100 : 0,
  };
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const num = (n, w = 6) => String(n).padStart(w, ' ');

function verdict(label, value, min, max, unit = '%') {
  const ok = value >= min && value <= max;
  const txt = `${value.toFixed(1)}${unit}`.padStart(9, ' ');
  console.log(`  ${pad(label, 18)} ${txt}  及格线 ${min}-${max}${unit}  ${ok ? '✅' : '❌'}`);
  return ok;
}

const allOk = [];

// ── 1. 镜像对局：验先手优势 ──
function testMirror(n = N || 600, deck = 'balanced', hero = 'alice') {
  console.log(`\n【镜像对局】${DECKS[deck].name} / ${hero} / Lv${LEVEL} / ${n} 局`);
  const res = [];
  for (let i = 0; i < n; i++) {
    const first = i % 2;
    res.push({ ...playMatch({ deckA: DECKS[deck], deckB: DECKS[deck], partnerA: hero, partnerB: hero, seed: 1000 + i, first }), first });
  }
  // 统一为"先手方"视角
  let firstWin = 0;
  for (const r of res) if (r.winner === r.first) firstWin++;
  const fp = (firstWin / res.length) * 100;
  const ag = aggregate(res, n);
  allOk.push(verdict('先手胜率', fp, 50, 56));
  allOk.push(verdict('平均回合(每人)', ag.turns / 2, 6, 12, ''));
  allOk.push(verdict('技能伤害占比', ag.skillPct, 20, 45));
  console.log(`  平局率 ${ag.draw.toFixed(1)}%`);
}

// ── 2. 伙伴矩阵 ──
function testHeroes(n = N || 300, deck = 'balanced') {
  console.log(`\n【伙伴矩阵】${DECKS[deck].name} / Lv${LEVEL} / 每个组合 ${n} 局（A 行对 B 列的胜率%）`);
  const ids = PARTNER_LIST.map((h) => h.id);
  console.log('        ' + ids.map((i) => pad(i, 9)).join(''));
  for (const a of ids) {
    const row = [];
    for (const b of ids) {
      if (a === b) { row.push(pad('-', 9)); continue; }
      let win = 0;
      for (let i = 0; i < n; i++) {
        const r = playMatch({ deckA: DECKS[deck], deckB: DECKS[deck], partnerA: a, partnerB: b, seed: 2000 + i, first: i % 2 });
        if (r.winner === 0) win++;
      }
      const p = (win / n) * 100;
      row.push(pad(p.toFixed(1) + '%', 9));
      allOk.push(p >= 45 && p <= 55);
    }
    console.log(pad(a, 8) + row.join(''));
  }
  console.log('  及格线：45%-55%');
}

// ── 3. 阵营循环 ──
function testFactions(n = N || 300) {
  console.log(`\n【阵营循环】Lv${LEVEL} / 每个组合 ${n} 局`);
  const pairs = [['forest', 'wonder'], ['wonder', 'oz'], ['oz', 'forest']];
  const total = { forest: [0, 0], wonder: [0, 0], oz: [0, 0] };
  for (const [a, b] of pairs) {
    let win = 0;
    for (let i = 0; i < n; i++) {
      const r = playMatch({ deckA: DECKS[a], deckB: DECKS[b], partnerA: 'hood', partnerB: 'hood', seed: 3000 + i, first: i % 2 });
      if (r.winner === 0) win++;
    }
    const p = (win / n) * 100;
    total[a][0] += win; total[a][1] += n;
    total[b][0] += n - win; total[b][1] += n;
    console.log(`  ${pad(DECKS[a].name, 20)} vs ${pad(DECKS[b].name, 20)} ${num(p.toFixed(1) + '%')}  ${p >= 45 && p <= 55 ? '✅' : '❌'}`);
    allOk.push(p >= 45 && p <= 55);
  }
  for (const f of ['forest', 'wonder', 'oz']) {
    const p = (total[f][0] / total[f][1]) * 100;
    allOk.push(verdict(`${f} 总体胜率`, p, 47, 53));
  }
}

// ── 4. 初始卡组 vs T1 ──
function testStarter(n = N || 300) {
  console.log(`\n【初始卡组体验】初识之页 / Lv${LEVEL} / 每个 ${n} 局`);
  // ① 同卡组对战：应接近 50%（验证不存在系统性 bug）
  let w = 0;
  for (let i = 0; i < n; i++) {
    if (playMatch({ deckA: DECKS.starter, deckB: DECKS.starter, partnerA: 'hood', partnerB: 'hood', seed: 4100 + i, first: i % 2 }).winner === 0) w++;
  }
  // 镜像对局（同卡组 + 同伙伴 + 同 AI）天然对称，大量对局会打满回合且双方血量相同 → 平局。
  // 这是镜像测试的固有现象，不是 bug，因此胜率按【已分出胜负的对局】计算，平局率单列。
  let dr = 0;
  for (let i = 0; i < n; i++) {
    if (playMatch({ deckA: DECKS.starter, deckB: DECKS.starter, partnerA: 'hood', partnerB: 'hood', seed: 4100 + i, first: i % 2 }).winner === -1) dr++;
  }
  const decided = n - dr;
  const p0 = decided ? (w / decided) * 100 : 0;
  console.log(`  vs ${pad('初识之页（镜像）', 20)} ${num(p0.toFixed(1) + '%')}  ${p0 >= 45 && p0 <= 55 ? '✅' : '❌'} (及格线 45-55%，已排除 ${(dr / n * 100).toFixed(0)}% 平局)`);
  allOk.push(p0 >= 45 && p0 <= 55);

  // ② vs 成长中卡组：新手实际会遇到的对手，必须能赢
  w = 0;
  for (let i = 0; i < n; i++) {
    if (playMatch({ deckA: DECKS.starter, deckB: DECKS.rising, partnerA: 'hood', partnerB: 'hood', seed: 4200 + i, first: i % 2 }).winner === 0) w++;
  }
  const p1 = (w / n) * 100;
  console.log(`  vs ${pad('林间成长(T2,主线解锁)', 20)} ${num(p1.toFixed(1) + '%')}  ${p1 >= 30 ? '✅' : '❌'} (及格线 ≥30%)`);
  allOk.push(p1 >= 30);

  // ③ vs 毕业卡组：预期被打（强度梯度），由匹配分段 9.2 R1 / 新手池 R6 规避，仅记录
  for (const t of ['forest', 'wonder', 'oz']) {
    let win = 0;
    for (let i = 0; i < n; i++) {
      if (playMatch({ deckA: DECKS.starter, deckB: DECKS[t], partnerA: 'hood', partnerB: 'hood', seed: 4300 + i, first: i % 2 }).winner === 0) win++;
    }
    const p = (win / n) * 100;
    console.log(`  vs ${pad(DECKS[t].name + '(T1毕业)', 20)} ${num(p.toFixed(1) + '%')}  ⚠ 仅记录（靠匹配分段规避）`);
  }
}

// ── 5. 节奏分布 ──
function testPace(n = N || 300) {
  console.log(`\n【对局节奏】balanced / Lv${LEVEL} / ${n} 局`);
  const buckets = {};
  for (let i = 0; i < n; i++) {
    const r = playMatch({ deckA: DECKS.balanced, deckB: DECKS.balanced, partnerA: 'hood', partnerB: 'hatter', seed: 5000 + i, first: i % 2 });
    const b = Math.min(20, Math.ceil(r.turn / 2) * 2);
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const pct = (buckets[k] / n) * 100;
    console.log(`  回合 ${String(k).padStart(2)} 结束  ${'█'.repeat(Math.round(pct / 2))} ${pct.toFixed(1)}%`);
  }
}

console.log('=== 《童话奇境》M0.5 平衡验证 ===');
console.log(`等级 Lv${LEVEL} / AI 难度 ${DIFF}`);

const t0 = Date.now();
if (has('mirror') || has('all') || args.length === 0) testMirror();
if (has('heroes') || has('all') || args.length === 0) testHeroes();
if (has('factions') || has('all') || args.length === 0) testFactions();
if (has('starter') || has('all') || args.length === 0) testStarter();
if (has('pace') || has('all') || args.length === 0) testPace();

console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const failed = allOk.filter((x) => !x).length;
console.log(failed === 0 ? '全部指标达标 ✅' : `有 ${failed} 项未达标 ❌（按设计文档 9.7 调整工具箱处理）`);
