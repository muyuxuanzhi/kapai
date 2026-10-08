// 生成黑底白字占位图（SVG），并输出《图片需求清单.md》
// 用法: node tools/gen_placeholders.js
// 美术就位后，直接替换 assets/art/ 下同名文件即可（尺寸保持一致）

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS, FACTION_META } from '../src/data/cards.js';
import { PARTNER_LIST } from '../src/data/partners.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(w, h, lines) {
  const body = lines
    .map((l, i) => {
      const y = h / 2 + (i - (lines.length - 1) / 2) * l.size * 1.6;
      return `<text x="${w / 2}" y="${y.toFixed(0)}" font-family="Microsoft YaHei,PingFang SC,sans-serif" font-size="${l.size}" fill="${l.color || '#ffffff'}" text-anchor="middle">${esc(l.t)}</text>`;
    })
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#000000"/>
  <rect x="3" y="3" width="${w - 6}" height="${h - 6}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 6"/>
  ${body}
</svg>
`;
}

const CARD_W = 300, CARD_H = 220, HERO_W = 400, HERO_H = 400;
mkdirSync(join(root, 'assets/art/cards'), { recursive: true });
mkdirSync(join(root, 'assets/art/heroes'), { recursive: true });

const list = [];

for (const c of CARDS) {
  const f = FACTION_META[c.faction];
  const type = c.type === 'companion' ? '伙伴卡' : '奇遇卡';
  const spec = c.type === 'companion' ? `${c.hp} 生命 / ${c.atk} 攻击 · ${c.cost} 费` : `${c.text} · ${c.cost} 费`;
  writeFileSync(
    join(root, 'assets/art/cards', `${c.id}.svg`),
    svg(CARD_W, CARD_H, [
      { t: c.name, size: 30 },
      { t: `${type} · ${f.icon} ${f.name}`, size: 16, color: '#bbbbbb' },
      { t: spec, size: 14, color: '#999999' },
      { t: `占位图 ${CARD_W}×${CARD_H} · 替换 ${c.id}.svg`, size: 12, color: '#777777' },
    ])
  );
  list.push({ file: `assets/art/cards/${c.id}.svg`, size: `${CARD_W}×${CARD_H}`, name: c.name, desc: `${type}｜${f.name}｜${spec}` });
}

for (const h of PARTNER_LIST) {
  writeFileSync(
    join(root, 'assets/art/heroes', `${h.id}.svg`),
    svg(HERO_W, HERO_H, [
      { t: h.name, size: 44 },
      { t: `${h.quality} 级 · ${h.title}`, size: 20, color: '#bbbbbb' },
      { t: `主动：${h.skills.active.name} / 终极：${h.skills.ultimate.name}`, size: 14, color: '#999999' },
      { t: `占位图 ${HERO_W}×${HERO_H} · 替换 ${h.id}.svg`, size: 12, color: '#777777' },
    ])
  );
  list.push({ file: `assets/art/heroes/${h.id}.svg`, size: `${HERO_W}×${HERO_H}`, name: h.name, desc: `伙伴头像/立绘｜${h.quality} 级 ${h.title}` });
}

// UI 占位图
const ui = [
  ['cardback.svg', '卡背', 200, 280],
  ['frame_companion.svg', '伙伴卡边框', 300, 220],
  ['frame_spell.svg', '奇遇卡边框', 300, 220],
  ['slot_empty.svg', '空伙伴位', 110, 150],
];
mkdirSync(join(root, 'assets/art/ui'), { recursive: true });
for (const [file, name, w, h] of ui) {
  writeFileSync(join(root, 'assets/art/ui', file), svg(w, h, [
    { t: name, size: Math.min(24, w / 6) },
    { t: `${w}×${h}`, size: 12, color: '#888888' },
  ]));
  list.push({ file: `assets/art/ui/${file}`, size: `${w}×${h}`, name, desc: 'UI 素材' });
}

// 清单
let md = `# 图片需求清单

> 当前全部为**黑底白字 SVG 占位图**（由 \`node tools/gen_placeholders.js\` 生成）。
> 美术就位后**直接替换同名文件**即可，代码无需改动；建议保持相同尺寸与透明/不透明约定。

## 1. 伙伴立绘 / 头像（4 张，${HERO_W}×${HERO_H}）

| 文件 | 角色 | 内容建议 |
|---|---|---|
`;
for (const h of PARTNER_LIST) {
  md += `| \`assets/art/heroes/${h.id}.svg\` | ${h.name}（${h.title}） | ${h.quality} 级伙伴，半身立绘，童话书插画风 |\n`;
}
md += `
## 2. 卡牌插画（35 张，${CARD_W}×${CARD_H}）

| 文件 | 卡名 | 内容建议 |
|---|---|---|
`;
for (const c of CARDS) {
  const f = FACTION_META[c.faction];
  md += `| \`assets/art/cards/${c.id}.svg\` | ${c.name} | ${f.icon}${f.name}｜${c.type === 'companion' ? `伙伴 ${c.hp}/${c.atk}` : c.text} |\n`;
}
md += `
## 3. UI 素材（4 张）

| 文件 | 用途 | 尺寸 |
|---|---|---|
`;
for (const [file, name, w, h] of ui) md += `| \`assets/art/ui/${file}\` | ${name} | ${w}×${h} |\n`;

md += `
## 4. 后续扩展（可选）

- 背景图：故事书舞台 1920×1080（仙境 / 森林 / 奥兹 三套）
- 卡背：稀有度专属卡背 4 种
- 技能图标：12 个（4 伙伴 × 主动/被动/终极），128×128
- 结局演出：胜利「故事书合拢」/ 失败 1920×1080
`;

writeFileSync(join(root, '图片需求清单.md'), md);
console.log(`已生成 ${list.length} 张占位图 + 图片需求清单.md`);
