// 卡牌数据表：20 助手卡 + 15 奇遇卡
// faction: wonder(仙境) / forest(森林) / oz(奥兹)
// acquire: starter(初始) / quest(主线) / gacha(抽卡) / craft(合成)
// effects[].op 由 rules.js 统一解释

export const CARDS = [
  // ───────── 助手卡 ─────────
  // 仙境整体偏弱（实测阵营胜率仅 27%）：1 费卡与 2 费卡全部上调，让前期能站住
  { id: 'c01', name: '白兔先生', faction: 'wonder', type: 'companion', cost: 1, hp: 9, atk: 4, rarity: 'common', acquire: 'starter', text: '', effects: [] },
  { id: 'c02', name: '扑克园丁', faction: 'wonder', type: 'companion', cost: 2, hp: 13, atk: 5, rarity: 'common', acquire: 'starter', text: '', effects: [] },
  { id: 'c03', name: '三月兔', faction: 'wonder', type: 'companion', cost: 2, hp: 12, atk: 5, rarity: 'rare', acquire: 'quest', text: '', effects: [] },
  { id: 'c04', name: '疯帽子的茶壶', faction: 'wonder', type: 'companion', cost: 2, hp: 10, atk: 3, rarity: 'common', acquire: 'gacha', text: '登场：本回合梦力 +1', effects: [{ op: 'mana', value: 1 }] },
  { id: 'c05', name: '红心王后', faction: 'wonder', type: 'companion', cost: 4, hp: 24, atk: 7, rarity: 'epic', acquire: 'gacha', text: '嘲讽', keywords: ['taunt'], effects: [] },
  // 卡面写「抽 2 张」但效果只有 1 张（描述不符）—— 修正为真的抽 2 张，并下调身材作为代价
  { id: 'c06', name: '柴郡猫', faction: 'wonder', type: 'companion', cost: 5, hp: 22, atk: 6, rarity: 'epic', acquire: 'craft', text: '登场：抽 2 张牌', effects: [{ op: 'draw', value: 2 }] },
  // 7 费几乎打不出来，降到 6 费
  { id: 'c07', name: '巨龙贾布沃克', faction: 'wonder', type: 'companion', cost: 6, hp: 33, atk: 10, rarity: 'legend', acquire: 'craft', text: '', effects: [] },

  { id: 'c08', name: '森林松鼠', faction: 'forest', type: 'companion', cost: 2, hp: 12, atk: 4, rarity: 'common', acquire: 'starter', text: '', effects: [] },
  { id: 'c09', name: '猎犬', faction: 'forest', type: 'companion', cost: 2, hp: 10, atk: 5, rarity: 'rare', acquire: 'gacha', text: '登场：抽 1 张牌', effects: [{ op: 'draw', value: 1 }] },
  { id: 'c10', name: '森林精灵', faction: 'forest', type: 'companion', cost: 3, hp: 18, atk: 3, rarity: 'rare', acquire: 'quest', text: '登场：我方主角回复 2 生命', effects: [{ op: 'healHero', value: 5 }] },
  { id: 'c11', name: '银月猎人', faction: 'forest', type: 'companion', cost: 3, hp: 14, atk: 6, rarity: 'rare', acquire: 'gacha', text: '攻击时先造成 1 点固定伤害', keywords: ['firstStrike'], effects: [] },
  { id: 'c12', name: '老猎人', faction: 'forest', type: 'companion', cost: 4, hp: 20, atk: 6, rarity: 'rare', acquire: 'quest', text: '', effects: [] },
  { id: 'c13', name: '大灰狼', faction: 'forest', type: 'companion', cost: 4, hp: 16, atk: 7, rarity: 'epic', acquire: 'gacha', text: '攻击后可再攻击一次（每场 1 次）', keywords: ['doubleOnce'], effects: [] },
  { id: 'c14', name: '森林外婆', faction: 'forest', type: 'companion', cost: 6, hp: 32, atk: 9, rarity: 'legend', acquire: 'craft', text: '登场：我方全体助手 +2 生命', effects: [{ op: 'buffAll', hp: 2, atk: 1 }] },

  // 奥兹身材曲线全面压制仙境（实测 59.4%），下调高攻卡的攻击力
  { id: 'c15', name: '稻草人', faction: 'oz', type: 'companion', cost: 3, hp: 18, atk: 6, rarity: 'common', acquire: 'starter', text: '', effects: [] },
  { id: 'c16', name: '翡翠城乐团', faction: 'oz', type: 'companion', cost: 3, hp: 16, atk: 6, rarity: 'epic', acquire: 'gacha', text: '登场：我方全体助手 +2 攻击', effects: [{ op: 'buffAll', hp: 1, atk: 2 }] },
  // 奥兹嘲讽墙过强（实测阵营胜率 78%）：两张嘲讽各降 2 点生命
  { id: 'c17', name: '胆小狮', faction: 'oz', type: 'companion', cost: 3, hp: 19, atk: 4, rarity: 'common', acquire: 'starter', text: '嘲讽', keywords: ['taunt'], effects: [] },
  { id: 'c18', name: '翡翠城守卫', faction: 'oz', type: 'companion', cost: 4, hp: 23, atk: 5, rarity: 'rare', acquire: 'quest', text: '嘲讽；登场：我方主角获得 3 护盾', keywords: ['taunt'], effects: [{ op: 'shield', value: 2 }] },
  { id: 'c19', name: '西方女巫', faction: 'oz', type: 'companion', cost: 5, hp: 23, atk: 9, rarity: 'epic', acquire: 'gacha', text: '', effects: [] },
  { id: 'c20', name: '铁皮樵夫', faction: 'oz', type: 'companion', cost: 6, hp: 29, atk: 9, rarity: 'legend', acquire: 'craft', text: '登场：随机使一个敌方助手攻击力减半', effects: [{ op: 'halveAtk' }] },

  // ───────── 奇遇卡（= 原作「外援卡」）─────────
  // subtype 对应原作左下角类型图标：attack 攻击卡 / buff 增益卡 / support 辅助卡
  // 直伤可绕过嘲讽墙，是仙境对抗奥兹的关键手段（6 → 8）
  { id: 's01', name: '茶杯风暴', faction: 'wonder', type: 'spell', subtype: 'attack', cost: 2, rarity: 'common', acquire: 'starter', text: '对敌方伙伴造成 7 点伤害', effects: [{ op: 'dmgHero', value: 7 }] },
  { id: 's02', name: '银弹', faction: 'forest', type: 'spell', subtype: 'attack', cost: 3, rarity: 'rare', acquire: 'quest', text: '对一个敌方助手造成 14 点伤害', needTarget: 'enemyUnit', effects: [{ op: 'dmgOne', value: 14 }] },
  // 4 费全体 8 点是全场最强解场，涨到 5 费
  { id: 's03', name: '龙卷风', faction: 'oz', type: 'spell', subtype: 'attack', cost: 5, rarity: 'epic', acquire: 'craft', text: '对敌方全体助手造成 9 点伤害', effects: [{ op: 'dmgAll', value: 9 }] },
  { id: 's04', name: '砍掉他的头！', faction: 'wonder', type: 'spell', subtype: 'attack', cost: 5, rarity: 'legend', acquire: 'craft', text: '对敌方全体助手 2 点（溢出打伙伴），再对敌方伙伴 10 点', effects: [{ op: 'dmgAll', value: 10, overflow: true }, { op: 'dmgHero', value: 10 }] },
  { id: 's05', name: '森林号角', faction: 'forest', type: 'spell', subtype: 'buff', cost: 2, rarity: 'common', acquire: 'starter', text: '我方全体助手 +2 攻击', effects: [{ op: 'buffAll', hp: 1, atk: 1 }] },
  { id: 's06', name: '外婆的点心', faction: 'forest', type: 'spell', subtype: 'buff', cost: 3, rarity: 'rare', acquire: 'quest', text: '一个我方助手 +1/+1', needTarget: 'allyUnit', effects: [{ op: 'buffOne', hp: 1, atk: 1 }] },
  // 伙伴总血量只有 25~33，10 点护盾占 1/3 血，降到 7
  { id: 's07', name: '红宝石鞋', faction: 'oz', type: 'spell', subtype: 'buff', cost: 3, rarity: 'rare', acquire: 'craft', text: '我方伙伴获得 8 点护盾', effects: [{ op: 'shield', value: 8 }] },
  { id: 's08', name: '奇境花开', faction: 'wonder', type: 'spell', subtype: 'buff', cost: 5, rarity: 'legend', acquire: 'craft', text: '我方全体助手 +1/+1', effects: [{ op: 'buffAll', hp: 1, atk: 1 }] },
  { id: 's09', name: '青春泉水', faction: 'wonder', type: 'spell', subtype: 'support', cost: 2, rarity: 'common', acquire: 'quest', text: '我方伙伴回复 8 生命', effects: [{ op: 'healHero', value: 8 }] },
  { id: 's10', name: '翻开下一页', faction: 'wonder', type: 'spell', subtype: 'support', cost: 2, rarity: 'common', acquire: 'starter', text: '抽 2 张牌', effects: [{ op: 'draw', value: 1 }] },
  { id: 's11', name: '林中小屋', faction: 'forest', type: 'spell', subtype: 'support', cost: 3, rarity: 'common', acquire: 'quest', text: '治疗一个我方助手 12 点', needTarget: 'allyUnit', effects: [{ op: 'healOne', value: 12 }] },
  { id: 's12', name: '托托的鼻子', faction: 'oz', type: 'spell', subtype: 'support', cost: 3, rarity: 'rare', acquire: 'gacha', text: '抽 1 张牌 + 本回合梦力 +1', effects: [{ op: 'draw', value: 1 }, { op: 'mana', value: 1 }] },
  { id: 's13', name: '暂停时间', faction: 'wonder', type: 'spell', subtype: 'support', cost: 4, rarity: 'rare', acquire: 'gacha', text: '接下来 2 回合手牌费用 −1', effects: [{ op: 'costReduce', value: 1, turns: 2 }] },
  { id: 's14', name: '小红斗篷', faction: 'forest', type: 'spell', subtype: 'buff', cost: 2, rarity: 'common', acquire: 'gacha', text: '一个我方助手 +2 生命上限并治疗', needTarget: 'allyUnit', effects: [{ op: 'healOne', value: 6, raiseMax: true }] },
  { id: 's15', name: '仙境蘑菇', faction: 'wonder', type: 'spell', subtype: 'support', cost: 1, rarity: 'common', acquire: 'gacha', text: '50% 抽 1 张 / 50% 梦力 +1', effects: [{ op: 'coinflip', a: { op: 'draw', value: 1 }, b: { op: 'mana', value: 1 } }] },

  // ── 控制卡（对齐原作「控制卡」：香水 / 聚光灯 / 禁言）──
  { id: 's16', name: '迷惑香水', faction: 'forest', type: 'spell', subtype: 'support', cost: 2, rarity: 'rare', acquire: 'quest', text: '使一个敌方助手下回合无法攻击', needTarget: 'enemyUnit', effects: [{ op: 'disableUnit' }] },
  { id: 's17', name: '聚光灯', faction: 'oz', type: 'spell', subtype: 'support', cost: 2, rarity: 'rare', acquire: 'quest', text: '敌方伙伴下回合无法攻击', effects: [{ op: 'disableHero' }] },
  { id: 's18', name: '禁言', faction: 'wonder', type: 'spell', subtype: 'support', cost: 3, rarity: 'epic', acquire: 'gacha', text: '2 回合内双方无法使用主动技', effects: [{ op: 'sealSkill', value: 2 }] },
];

/** 外援卡/奇遇卡类型图标（原作左下角图标：增益=红箭头、攻击=人像、辅助=叶子） */
export const SPELL_KIND = {
  attack: { icon: '👤', name: '攻击卡', desc: '造成伤害', color: '#e74c3c' },
  buff: { icon: '🔺', name: '增益卡', desc: '强化己方', color: '#ffd86b' },
  support: { icon: '🍃', name: '辅助卡', desc: '抽牌/治疗/资源', color: '#6bcb77' },
};

export function describeEffect(e) {
  const v = e.value || 0;
  const stats = [e.atk ? `攻击 +${e.atk}` : '', e.hp ? `生命及上限 +${e.hp}` : ''].filter(Boolean).join('、');
  switch (e.op) {
    case 'draw': return `抽 ${v} 张牌`;
    case 'mana': return `本回合梦力 +${v}`;
    case 'healHero': return `我方角色回复 ${v} 生命`;
    case 'shield': return `我方角色获得 ${v} 护盾`;
    case 'dmgHero': return `对敌方角色造成 ${v} 点伤害`;
    case 'dmgOne': return `对一个敌方助手造成 ${v} 点伤害${e.overflow ? '，溢出伤害打角色' : ''}`;
    case 'dmgAll': return `对敌方全体存活助手造成 ${v} 点伤害${e.overflow ? '，溢出伤害打角色' : ''}`;
    case 'buffAll': return `我方全体存活助手${stats}`;
    case 'buffOne': return `一个我方助手${stats}`;
    case 'healOne': return e.raiseMax ? `一个我方助手生命及上限 +${v}` : `治疗一个我方助手 ${v} 点`;
    case 'halveAtk': return '随机使一个敌方存活助手攻击力减半';
    case 'disableUnit': return '一个敌方助手下次不能普攻';
    case 'disableHero': return '敌方角色下次不能普攻';
    case 'sealSkill': return `${v} 回合内双方禁用主动技`;
    case 'costReduce': return `本回合及下个己方回合，手牌费用 -${v}（最低 0）`;
    case 'coinflip': return `50%：${describeEffect(e.a)}；50%：${describeEffect(e.b)}`;
    default: return '';
  }
}

for (const c of CARDS) {
  const keywords = (c.keywords || []).map(k => ({ taunt: '嘲讽', firstStrike: '攻击助手时先造成 2 点伤害', doubleOnce: '首次攻击追加一次普攻（每次登场一次）' }[k] || k));
  const effects = c.effects.map(describeEffect).filter(Boolean).join('；');
  c.text = [...keywords, effects ? (c.type === 'companion' ? '登场：' : '') + effects : ''].filter(Boolean).join('；');
}

export const CARD_INDEX = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const RARITY_COLOR = {
  common: '#9aa0a6',
  rare: '#5b8def',
  epic: '#a86fe8',
  legend: '#ffd86b',
};

export const FACTION_META = {
  wonder: { key: 'wonder', icon: '🃏', name: '仙境', color: '#6fd3c7' },
  forest: { key: 'forest', icon: '🧺', name: '森林', color: '#e74c3c' },
  oz: { key: 'oz', icon: '🌪', name: '奥兹', color: '#7fb7e8' },
};
