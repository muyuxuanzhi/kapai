// 伙伴数据表：技能消耗梦力 + 按回合冷却（见设计文档 2.6 / 4.2）
// 对局内换算：生命 = 120 + 面板生命×2；攻击 = 10 + 面板攻击×2

export const PARTNERS = {
  alice: {
    id: 'alice', name: '爱丽丝', title: '仙境之主', quality: 'S', faction: 'wonder',
    base: { hp: 27, atk: 13 }, growth: { hp: 5, atk: 3 },
    skillScale: 0.495, // 技能强度系数，由 tools/balance.js 自动标定（重跑 `node tools/balance.js` 可刷新）
    art: 'assets/art/heroes/alice.svg',
    skills: {
      // 首版直伤过低（Lv10 仅 11 点），实测对小红帽胜率仅 13%，已上调
      // 基础值按「Lv10 直伤 10 / 溅射 4 / 减疗 6」设定（旧值 base2·coef0.15 配合低 scale
      // 导致 Lv10 只造成 1 点伤害，属于量级错误，已重设）
      active: {
        name: '疯长蘑菇', cost: 2, cd: 2, unlock: 1, op: 'dmgHero', base: 7, coef: 0.12,
        also: { op: 'dmgAll', base: 3, coef: 0.05 },  // 附带溅射解场，避免纯直伤被场面流克制
        also2: { op: 'healReduce', base: 5, coef: 0.08, turns: 2 }, // 减疗：压制治疗续航流
      },
      ultimate: {
        name: '仙境审判', cost: 3, cd: 3, unlock: 10, op: 'dmgHero', base: 11, coef: 0.18,
        also: { op: 'dmgAll', base: 5, coef: 0.08 },
      },
      passive: { name: '镜中反射', unlock: 5, op: 'reflect', value: 2, perTurn: 2 },
    },
  },
  hood: {
    id: 'hood', name: '小红帽', title: '森林巡礼', quality: 'B', faction: 'forest',
    base: { hp: 25, atk: 12 }, growth: { hp: 4, atk: 2 },
    skillScale: 0.996, atk: 6, hp: 33,
    art: 'assets/art/heroes/hood.svg',
    skills: {
      // 治疗在长局中过强（首版对爱丽丝 87.5%），已下调治疗量与抽牌上限
      active: {
        name: '篮中点心', cost: 2, cd: 2, unlock: 1, op: 'healHero', base: 10, coef: 0.15,
        also: { op: 'buffAll', hp: 2, atk: 0 },
        also2: { op: 'draw', value: 1 },
      },
      ultimate: { name: '月夜狼嚎', cost: 3, cd: 3, unlock: 10, op: 'buffAllTemp', atk: 3, dur: 2 },
      // 我方助手死亡时回血：对症清场流（否则被桃乐丝克到 24.7%）
      // 被动不受 skillScale 影响，是 hood 强度的主要来源（实测克 alice 79%），需单独削弱
      passive: { name: '林间回响', unlock: 5, op: 'healOnDeath', value: 3, max: 5, drawAlso: true },
    },
  },
  dorothy: {
    id: 'dorothy', name: '桃乐丝', title: '龙卷之旅', quality: 'B', faction: 'oz',
    base: { hp: 25, atk: 12 }, growth: { hp: 4, atk: 2 },
    skillScale: 1.056, atk: 7, hp: 31, // 血量 29→31：缓解被爱丽丝直伤克制（76.3%）
    art: 'assets/art/heroes/dorothy.svg',
    skills: {
      active: { name: '龙卷气旋', cost: 2, cd: 2, unlock: 1, op: 'dmgOne', base: 11, coef: 0.15, onKill: 'draw' },
      ultimate: { name: '回家吧，托托', cost: 3, cd: 3, unlock: 10, op: 'dmgAll', base: 7, coef: 0.1 },
      passive: { name: '黄砖路指引', unlock: 5, op: 'manaEvery3', value: 1 },
    },
  },
  hatter: {
    id: 'hatter', name: '疯帽子', title: '时间茶会', quality: 'S', faction: 'wonder',
    base: { hp: 27, atk: 13 }, growth: { hp: 5, atk: 3 },
    skillScale: 0.748, atk: 8, hp: 25,
    art: 'assets/art/heroes/hatter.svg',
    skills: {
      // 首版三项技能叠加过强（实测对其他三伙伴 95%~99.5% 胜率），全面下调
      active: { name: '茶壶投掷', cost: 2, cd: 2, unlock: 1, op: 'dmgOne', base: 10, coef: 0.12 },
      ultimate: { name: '镜像茶客', cost: 3, cd: 3, unlock: 10, op: 'summon', hp: 16, atk: 16 },
      passive: { name: '时间碎片', unlock: 5, op: 'atkOnDeath', value: 1, max: 4 },
    },
  },
};

export const PARTNER_LIST = Object.values(PARTNERS);

/**
 * 伙伴面板 → 对局内属性
 * 攻击系数由文档原版 ×2 下调为 ×0.5：原值下伙伴一击即可秒杀任何伙伴，
 * 伙伴无法充当"墙"，对局平均只有 6.8 回合（及格线 8-14）。
 * 攻击系数 = 0.5 时伙伴需要 1-2 击才能清掉一个伙伴，伙伴成为真正的护盾。
 */
/**
 * 对局内伙伴属性：温和线性成长
 *
 * 原方案（120 + 面板×2 / 10 + 面板×2）实测问题：
 *   Lv10 伙伴攻击 90→对局 13.3 回合（僵持），Lv30 攻击 210→仅 6.7 回合且先手胜率 63%。
 *   攻击随等级翻倍而血量只增 1.5 倍，导致节奏与先后手优势随等级剧烈摆动。
 * 现方案把等级影响压到 1.3~1.9 倍，养成的强度差异主要交给【卡组与卡牌升级】承担。
 *
 * 参数由 tools/tune.js 扫描确定，改完请重跑 node sim.js --all
 */
export const TUNE = {
  // 战斗改为「整轮结算一次」后先手优势消失，后手补偿反而导致后手必胜（先手胜率 0%），故先归零。
  // 待实测确认对称后的基线偏差，再重新标定。
  // 交替回合制下，先手方攻击时后手方还没进行本轮行动（先手已用 2 回合资源、后手只有 1 回合），
  // 这个优势是每回合持续的，一次性护盾补不回来 → 用持续梦力补偿（原版即「后手多 1 点魔力」）
  secondManaTurns: 10,           // 后手补偿：前 N 个回合梦力 +1
  // 手牌补偿实测反常（Lv30 反而把先手胜率推到 77%，可能是 AI 在手牌溢出时决策变差），暂不启用
  secondHandExtra: 0,            // 后手补偿：起始手牌多 N 张
};

/**
 * 伙伴生命区间：25~33。
 * 规则：**攻击力越高，生命越低**（玻璃大炮 ↔ 肉盾的取舍）。
 * 生命只随等级极小成长（每 10 级 +1），并被夹在 25~33 之间。
 */
export const PARTNER_HP_RANGE = { min: 25, max: 33 };

/**
 * 后手补偿护盾：随等级递减。
 * 固定值无法同时满足各等级——实测 Lv10 需要 ~155 才平衡，Lv30 只需 ~91
 * （Lv30 技能占比高、先手优势基线更小），故用线性公式 + 上下限夹紧。
 */
export function secondShieldFor(level) {
  // 战斗改为「整轮结算一次 + 双方各出手一次」后，先手优势大幅收敛（原 60~93%）：
  // 无补偿实测 Lv10 64.6% / Lv20 51.4% / Lv30 52.0%，只有低等级段还需少量补偿。
  // Lv10 补偿 1 点护盾 → 54.1%（1200 局），高等级段无需补偿。
  // 交替回合制（只有当前方攻击）下重新标定，配合后手每回合 +1 梦力：
  if (level < 15) return 4;   // Lv10 → 60.0%（4→60.0% / 5→41.4% 断崖，取更接近的 4）
  if (level < 25) return 5;   // Lv20 → 55.0% ✅
  return 11;                  // Lv30 → 54.6% ✅
}

/**
 * 伙伴攻击力【固定值，不随等级成长】，全部落在 6~8 区间。
 * 之前主角攻击随等级涨到 32~40，一击就能秒掉任何助手，助手卡完全失去意义；
 * 现在主角只是"补刀/收尾"手段，胜负交给助手卡与卡牌。
 */
export const PARTNER_ATK_RANGE = { min: 6, max: 8 };

export function partnerStats(partnerId, level) {
  const h = PARTNERS[partnerId];
  // 攻击固定（6~8，不随等级成长）
  const atk = Math.min(PARTNER_ATK_RANGE.max, Math.max(PARTNER_ATK_RANGE.min, h.atk ?? 7));
  // 生命：基础值 + 每 10 级 +1，夹在 25~33
  const hp = Math.min(PARTNER_HP_RANGE.max, Math.max(PARTNER_HP_RANGE.min, (h.hp ?? 30) + Math.floor((level - 1) / 10)));
  return { hp, atk };
}

/** 技能实际数值（随等级成长，向下取整） */
export function skillValue(skill, level) {
  if (skill.base === undefined) return 0;
  return skill.base + Math.floor((skill.coef || 0) * level);
}

export function skillDescription(partner, key, level = 10) {
  const sk = partner.skills[key];
  const k = partner.skillScale ?? 1;
  const effect = s => {
    const v = Math.round(skillValue(s, level) * k);
    switch (s.op) {
      case 'dmgHero': return `敌方角色受到 ${v} 伤害`;
      case 'dmgOne': return `一个敌方助手受到 ${v} 伤害${s.onKill ? '，击杀后抽 1 张' : ''}`;
      case 'dmgAll': return `敌方全体存活助手受到 ${v} 伤害`;
      case 'healHero': return `角色回复 ${v} 生命`;
      case 'buffAll': return `我方存活助手生命及上限 +${Math.round(s.hp * k)}`;
      case 'buffAllTemp': return `我方助手攻击 +${Math.round(s.atk * k)}，持续 ${s.dur} 个己方回合`;
      case 'summon': return `召唤 ${Math.round(s.hp * k)} 生命 / ${Math.round(s.atk * k)} 攻击的影子茶客，需空位`;
      case 'draw': return `抽 ${s.value} 张牌`;
      case 'healReduce': return `敌方每次治疗减少 ${v}，持续至其第 ${s.turns} 次回合开始`;
      case 'reflect': return `受到攻击时反弹 ${s.value}，每回合最多 ${s.perTurn} 次`;
      case 'healOnDeath': return `我方助手阵亡时回复 ${s.value} 生命${s.drawAlso ? '并抽 1 张' : ''}，每局最多 ${s.max} 次`;
      case 'atkOnDeath': return `我方助手阵亡时角色攻击 +${s.value}，每局最多 +${s.max}`;
      case 'manaEvery3': return `每第 3 个己方回合额外获得 ${s.value} 梦力`;
      default: return s.text || '';
    }
  };
  return [sk, sk.also, sk.also2].filter(Boolean).map(effect).join('；');
}
