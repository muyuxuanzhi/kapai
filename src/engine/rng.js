// 可序列化的种子随机（mulberry32）
// 状态就是一个 uint32，能随 state 一起 clone / 存档 / 回放

export function nextRandom(seed) {
  let s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function randInt(seed, n) {
  const [r, s] = nextRandom(seed);
  return [Math.floor(r * n), s];
}

export function shuffle(arr, seed) {
  let s = seed >>> 0;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const [r, s2] = nextRandom(s);
    s = s2;
    const j = Math.floor(r * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return [a, s];
}
