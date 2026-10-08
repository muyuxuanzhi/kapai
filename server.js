// 联机服务端（M2）：权威服务端 + 房间码 + 事件流
// 零依赖：Node 原生 http（静态资源）+ SSE（服务端→客户端推送）+ POST（客户端→服务端发意图）
// 传输层可整体替换为 WebSocket，协议与消息格式保持不变。
//
// 启动: node server.js 8000   →   http://localhost:8000

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, applyAction } from './src/engine/rules.js';
import { chooseAction } from './src/engine/ai.js';
import { DECKS } from './src/data/decks.js';

const root = join(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || 8000);
const RECONNECT_MS = 60000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/** @type {Map<string, Room>} */
const rooms = new Map();

function newRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

/** 只下发该玩家可见的信息：对手手牌只给数量，不下发牌面与牌库/种子 */
function sanitize(st, side) {
  const c = structuredClone(st);
  const foe = 1 - side;
  c.players[foe].hand = c.players[foe].hand.map(() => ({ hidden: true }));
  c.players[foe].drawPile = [];
  c.players[foe].deckBase = [];
  c.rng = 0;
  c.seed = 0;
  return c;
}

class Room {
  constructor(id, opts = {}) {
    this.id = id;
    this.slots = [null, null];      // {partnerId, deck, level, name}
    this.clients = [new Set(), new Set()]; // SSE 连接
    this.offlineAt = [0, 0];
    this.game = null;
    this.ai = !!opts.ai;            // 单人练习：服务端用 AI 扮演 side 1
    this.aiDiff = opts.aiDiff || 'normal';
    this.seq = 0;
    this.over = false;
  }

  send(side, payload) {
    const data = JSON.stringify(payload);
    for (const res of this.clients[side]) {
      res.write(`data: ${data}\n\n`);
    }
  }

  broadcast(payload) {
    for (const side of [0, 1]) {
      if (this.clients[side].size === 0) continue;
      this.send(side, { ...payload, state: this.game ? sanitize(this.game, side) : null, seq: this.seq });
    }
  }

  startIfReady() {
    if (this.game || !this.slots[0] || !this.slots[1]) return;
    const [a, b] = this.slots;
    // 客户端可直接传自定义卡组（6 助手 + 2 奇遇），否则用预设卡组
    const deckOf = (s) => (s.deckIds && s.deckIds.length ? s.deckIds : (DECKS[s.deck] || DECKS.starter).cards);
    this.game = createGame({
      deckA: deckOf(a),
      deckB: deckOf(b),
      partnerA: a.partnerId, partnerB: b.partnerId,
      levelA: a.level, levelB: b.level,
      seed: (Math.random() * 1e9) | 0,
      first: Math.random() < 0.5 ? 0 : 1,
    });
    this.broadcast({ e: 'GAME_START', first: this.game.first });
    this.maybeAiTurn();
  }

  /** AI 自动打完它的回合，并把全部事件一次性广播 */
  maybeAiTurn() {
    if (!this.ai || !this.game || this.game.over) return;
    let guard = 0;
    const events = [];
    while (!this.game.over && this.game.current === 1 && guard++ < 60) {
      const action = chooseAction(this.game, 1, this.aiDiff);
      const r = applyAction(this.game, action);
      if (!r.ok) break;
      this.game = r.state;
      events.push(...r.events);
      if (action.act === 'END_TURN') break;
    }
    if (!this.game.over && this.game.current === 1) {
      const r = applyAction(this.game, { act: 'END_TURN' });
      this.game = r.state;
      events.push(...r.events);
    }
    this.seq++;
    if (events.length) this.broadcast({ e: 'EVENTS', events });
    if (this.game.over) this.finish();
  }

  finish() {
    this.over = true;
    this.broadcast({ e: 'GAME_OVER', winner: this.game.winner });
  }
}

// ────────────── HTTP ──────────────

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ── API ──
    if (p === '/api/create' && req.method === 'POST') {
      const b = await readBody(req);
      const id = newRoomId();
      const room = new Room(id, { ai: b.ai, aiDiff: b.aiDiff });
      room.slots[0] = { partnerId: b.partner || 'hood', deck: b.deck || 'starter', level: b.level || 10, name: b.name || '玩家1' };
      if (room.ai) {
        room.slots[1] = { partnerId: b.aiPartner || 'alice', deck: b.aiDeck || 'balanced', level: b.level || 10, name: 'AI' };
      }
      rooms.set(id, room);
      room.startIfReady();
      return json(res, { ok: true, roomId: id, side: 0 });
    }

    if (p === '/api/join' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get((b.roomId || '').toUpperCase());
      if (!room) return json(res, { ok: false, msg: '房间不存在' }, 404);
      if (room.slots[1]) return json(res, { ok: false, msg: '房间已满' }, 409);
      if (room.ai) return json(res, { ok: false, msg: '该房间为 AI 练习房' }, 409);
      room.slots[1] = { partnerId: b.partner || 'hood', deck: b.deck || 'starter', level: b.level || 10, name: b.name || '玩家2' };
      room.startIfReady();
      return json(res, { ok: true, roomId: room.id, side: 1 });
    }

    if (p === '/api/state') {
      const room = rooms.get((url.searchParams.get('roomId') || '').toUpperCase());
      const side = Number(url.searchParams.get('side'));
      if (!room || !room.game) return json(res, { ok: false, msg: '房间未开局' }, 404);
      return json(res, { ok: true, state: sanitize(room.game, side), seq: room.seq });
    }

    if (p === '/api/action' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get((b.roomId || '').toUpperCase());
      if (!room || !room.game) return json(res, { ok: false, msg: '房间未开局' }, 404);
      if (room.over) return json(res, { ok: false, msg: '对局已结束' });
      const side = Number(b.side);
      if (room.game.current !== side) return json(res, { ok: false, msg: '不是你的回合' });
      if (b.seq !== undefined && b.seq < room.seq) return json(res, { ok: false, msg: '过期指令' });

      const r = applyAction(room.game, b.action); // 服务端权威：所有合法性校验在引擎内
      if (!r.ok) return json(res, { ok: false, msg: '非法操作' });
      room.game = r.state;
      room.seq++;
      room.broadcast({ e: 'EVENTS', events: r.events });
      if (room.game.over) room.finish();
      else room.maybeAiTurn();
      return json(res, { ok: true });
    }

    if (p === '/api/rooms') {
      return json(res, {
        ok: true,
        rooms: [...rooms.values()].map((r) => ({
          id: r.id, players: r.slots.filter(Boolean).length, ai: r.ai, over: r.over,
        })),
      });
    }

    // ── SSE 事件流 ──
    if (p === '/api/stream') {
      const room = rooms.get((url.searchParams.get('roomId') || '').toUpperCase());
      const side = Number(url.searchParams.get('side'));
      if (!room) { res.writeHead(404); return res.end('room not found'); }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      room.clients[side].add(res);
      room.offlineAt[side] = 0;
      res.write(`data: ${JSON.stringify({ e: 'CONNECTED', side })}\n\n`);
      if (room.game) {
        res.write(`data: ${JSON.stringify({
          e: room.over ? 'GAME_OVER' : 'STATE_SYNC',
          state: sanitize(room.game, side),
          winner: room.game.winner,
          seq: room.seq,
        })}\n\n`);
      }
      req.on('close', () => {
        room.clients[side].delete(res);
        if (!room.over) {
          room.offlineAt[side] = Date.now();
          room.send(1 - side, { e: 'OPPONENT_OFFLINE' });
          setTimeout(() => {
            if (room.clients[side].size === 0 && !room.over) {
              room.over = true;
              room.game.winner = 1 - side;
              room.broadcast({ e: 'GAME_OVER', winner: 1 - side, reason: 'opponent_timeout' });
            }
          }, RECONNECT_MS);
        }
      });
      return;
    }

    // ── 静态资源 ──
    let file = join(root, decodeURIComponent(p === '/' ? '/index.html' : p));
    const st = await stat(file);
    if (st.isDirectory()) throw new Error('dir');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, () => {
  console.log(`童话奇境：http://localhost:${PORT}`);
  console.log(`联机 API 已就绪（SSE 事件流 + POST 指令）`);
});
