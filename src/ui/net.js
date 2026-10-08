// 联机网络层（传输层：SSE 下行 + POST 上行；可整体替换为 WebSocket，协议不变）
// 客户端只发"意图"，一切结算以服务端下发的 state / events 为准

export class Net {
  constructor(base = '') { // base 仅 Node 端自测时需要（浏览器用同源相对路径）
    this.base = base;
    this.es = null;
    this.roomId = null;
    this.side = null;
    this.handlers = new Map();
  }

  on(type, cb) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(cb);
  }

  emit(type, payload) {
    for (const cb of this.handlers.get(type) || []) cb(payload);
  }

  async post(path, body) {
    const r = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async create(opts) {
    const r = await this.post('/api/create', opts);
    if (!r.ok) throw new Error(r.msg || '创建房间失败');
    this.roomId = r.roomId;
    this.side = r.side;
    this.openStream();
    return r;
  }

  async join(opts) {
    const r = await this.post('/api/join', opts);
    if (!r.ok) throw new Error(r.msg || '加入房间失败');
    this.roomId = r.roomId;
    this.side = r.side;
    this.openStream();
    return r;
  }

  openStream() {
    this.close();
    const es = new EventSource(`${this.base}/api/stream?roomId=${this.roomId}&side=${this.side}`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      this.emit(msg.e, msg);
    };
    es.onerror = () => this.emit('NET_ERROR', {});
    this.es = es;
  }

  async send(action) {
    return this.post('/api/action', { roomId: this.roomId, side: this.side, action });
  }

  close() {
    if (this.es) { this.es.close(); this.es = null; }
  }
}
