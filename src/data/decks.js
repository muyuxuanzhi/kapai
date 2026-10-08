// 卡组配置：初始卡组 + 测试用卡组（见设计文档 3.5）

/** 上场卡组固定 8 张 =【6 张助手卡 + 2 张奇遇卡】，编卡界面按此限制 */
export const DECK_SIZE = { companion: 6, spell: 2, total: 8 };

export const DECKS = {
  // 🟢 初始卡组「初识之页」：每阵营助手各 2 张，刻意不触发共鸣
  starter: {
    id: 'starter', name: '初识之页（初始卡组）', tier: 'T3',
    cards: ['c01', 'c02', 'c08', 'c10', 'c15', 'c17', 's01', 's10'],
  },
  // T1 参考卡组：三阵营共鸣各一套 + 一套混搭
  forest: {
    id: 'forest', name: '月夜狩猎（森林共鸣）', tier: 'T1',
    cards: ['c08', 'c09', 'c10', 'c11', 'c12', 'c14', 's02', 's05'],
  },
  wonder: {
    id: 'wonder', name: '茶会邀请（仙境共鸣）', tier: 'T1',
    cards: ['c01', 'c02', 'c03', 'c05', 'c06', 'c07', 's01', 's10'],
  },
  oz: {
    id: 'oz', name: '黄砖护道（奥兹共鸣）', tier: 'T1',
    cards: ['c15', 'c16', 'c17', 'c18', 'c19', 'c20', 's03', 's07'],
  },
  balanced: {
    id: 'balanced', name: '书页混搭（无共鸣）', tier: 'T2',
    cards: ['c02', 'c03', 'c08', 'c11', 'c15', 'c17', 's01', 's10'],
  },
  // T2「成长中」：初始卡组 + 主线解锁替换，不含史诗/传说 —— 代表玩了几天的玩家
  rising: {
    id: 'rising', name: '林间成长（主线解锁）', tier: 'T2',
    cards: ['c02', 'c08', 'c10', 'c11', 'c15', 'c17', 's01', 's05'],
  },
};

/** 统计卡组的助手阵营分布，返回激活的共鸣 */
export function resonanceOf(deckCards, cardIndex) {
  const count = { wonder: 0, forest: 0, oz: 0 };
  for (const id of deckCards) {
    const c = cardIndex[id];
    if (c && c.type === 'companion') count[c.faction]++;
  }
  for (const f of ['wonder', 'forest', 'oz']) {
    if (count[f] >= 3) return f;
  }
  return null;
}

export const BLESSING_TEXT = {
  wonder: '茶会邀请：开局额外抽 2 张，第 1 回合梦力 +1',
  forest: '月夜狩猎：本局我方召唤的助手攻击 +1',
  oz: '黄砖护道：开局我方角色获得 6 点护盾',
};
