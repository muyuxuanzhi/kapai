// AI 决策：只输出 Action，与真人/联机走完全相同的 applyAction 通道
import { legalActions, applyAction } from './rules.js';
import { nextRandom } from './rng.js';

export function evaluate(st, side) {
  if (st.over) return st.winner === side ? 1e6 : st.winner === -1 ? 0 : -1e6;
  const me = st.players[side];
  const foe = st.players[1 - side];
  let s = 0;
  s += (me.hp - foe.hp) * 1.0;
  s += (me.shield - foe.shield) * 0.4;
  for (let i = 0; i < 3; i++) {
    const a = me.board[i];
    const b = foe.board[i];
    if (a && !a.dead) s += a.hp * 0.6 + a.atk * 1.3 + (a.taunt ? 6 : 0);
    if (a && a.dead) s -= 5; // 残骸占着卡位是负担
    if (b && !b.dead) s -= b.hp * 0.6 + b.atk * 1.3 + (b.taunt ? 6 : 0);
    if (b && b.dead) s += 5;
  }
  s += (me.hand.length - foe.hand.length) * 8;
  s -= me.mana * 2; // 剩余梦力 = 浪费
  return s;
}

function simulate(st, action, side) {
  const r = applyAction(st, action);
  return { v: evaluate(r.state, side), state: r.state, ok: r.ok };
}

function opponentReply(st, side) {
  const opp = 1 - side;
  if (st.over || st.current !== opp) return evaluate(st, side);
  const acts = legalActions(st, opp);
  let worst = Infinity;
  for (const a of acts) {
    const r = applyAction(st, a);
    const v = evaluate(r.state, side);
    if (v < worst) worst = v;
  }
  return worst === Infinity ? evaluate(st, side) : worst;
}

export function chooseAction(st, side, difficulty = 'normal') {
  const acts = legalActions(st, side);
  const non = acts.filter((a) => a.act !== 'END_TURN');
  if (!non.length) return { act: 'END_TURN' };

  if (difficulty === 'easy') {
    const [r] = nextRandom(st.rng);
    return non[Math.floor(r * non.length)];
  }

  const cur = evaluate(st, side);
  const scored = non.map((a) => ({ a, v: simulate(st, a, side).v }));
  scored.sort((x, y) => y.v - x.v);

  if (difficulty === 'hard') {
    for (const item of scored.slice(0, 5)) {
      const r = applyAction(st, item.a);
      item.v = opponentReply(r.state, side);
    }
    scored.sort((x, y) => y.v - x.v);
  }

  const best = scored[0];
  return best.v > cur + 0.5 ? best.a : { act: 'END_TURN' };
}

/** 自动打完一整个回合，返回逐步过程（供 UI 播放动画） */
export function runAiTurn(st, side, difficulty = 'normal') {
  let cur = st;
  const steps = [];
  let guard = 0;
  while (!cur.over && cur.current === side && guard++ < 80) {
    const action = chooseAction(cur, side, difficulty);
    const r = applyAction(cur, action);
    if (!r.ok) break;
    steps.push({ action, events: r.events });
    cur = r.state;
    if (action.act === 'END_TURN') break;
  }
  if (!cur.over && cur.current === side) {
    const r = applyAction(cur, { act: 'END_TURN' });
    steps.push({ action: { act: 'END_TURN' }, events: r.events });
    cur = r.state;
  }
  return { state: cur, steps };
}
