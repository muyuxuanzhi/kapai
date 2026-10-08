// DOM 引用检查：确认 JS 里 $('xxx') / getElementById('xxx') 引用的节点都存在于 index.html
// 用途：防止"删了 DOM 但代码还在访问"导致页面 JS 崩溃（曾经因移除日志面板踩过坑）
// 用法: node tools/domcheck.js

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const ids = new Set();
for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);

// 模板字符串里动态生成的 id（如 partnerArt${v}、u-${v}-${slot}）按前缀放行
const dynamic = [/^partnerArt\d$/, /^partnerName\d$/, /^hpFill\d$/, /^hpText\d$/, /^partnerStat\d$/, /^skills\d$/, /^slots\d$/, /^u-\d-\d$/];

let missing = 0;
for (const f of ['src/ui/app.js', 'src/ui/home.js']) {
  const code = readFileSync(join(root, f), 'utf8');
  const refs = new Set();
  for (const m of code.matchAll(/\$\('([^']+)'\)/g)) refs.add(m[1]);
  for (const m of code.matchAll(/getElementById\('([^']+)'\)/g)) refs.add(m[1]);
  for (const id of refs) {
    if (ids.has(id)) continue;
    if (dynamic.some((re) => re.test(id))) continue;
    console.log(`❌ ${f} 引用了不存在的节点 #${id}`);
    missing++;
  }
  console.log(`检查 ${f}：${refs.size} 个引用`);
}

console.log(missing === 0 ? '\nDOM 引用全部存在 ✅' : `\n${missing} 个引用缺失 ❌`);
process.exit(missing === 0 ? 0 : 1);
