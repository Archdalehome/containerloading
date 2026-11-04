// 探针：横截面（柜宽 × 柜高）到底填了多少 —— 查「一排没装满就装下一排」。
// 用 100mm 网格逐片采样：某一排里，横截面上被箱子覆盖的格子占比。
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

function crossFill(pack, c, stepX, stepYZ) {
  const sx = stepX || 200;
  const sy = stepYZ || 100;
  const len = pack.length || 0;
  const rows = [];
  for (let x = 0; x < len - 1e-6; x += sx) {
    let hit = 0, total = 0;
    for (let y = 0; y < c.innerW; y += sy) {
      for (let z = 0; z < c.innerH; z += sy) {
        total++;
        const cx = x + sx / 2, cy = y + sy / 2, cz = z + sy / 2;
        const covered = pack.placements.some((p) =>
          cx >= p.x && cx < p.x + p.l && cy >= p.y && cy < p.y + p.w && cz >= p.z && cz < p.z + p.h);
        if (covered) hit++;
      }
    }
    rows.push({ x: x, fill: total ? hit / total : 0 });
  }
  return rows;
}

function summary(tag, pack, c) {
  if (!pack) { console.log(tag + '：无'); return; }
  if (!pack.length) {
    let m = 0;
    (pack.placements || []).forEach((p) => { m = Math.max(m, p.x + p.l); });
    pack.length = m;
  }
  if (!pack.length) { console.log(tag + '：空'); return; }
  const rows = crossFill(pack, c);
  const vals = rows.map((r) => r.fill);
  const min = Math.min(...vals);
  const first = vals[0];
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // 第一排（最里面 1m）里最空的那一片：用户就是看到这个才说"没装满"
  const firstMeter = vals.slice(0, Math.ceil(1000 / 200));
  const bar = (v) => '█'.repeat(Math.round(v * 20));
  console.log(tag + '  装 ' + pack.totals.loadedCount + ' 只 柜长 ' + (pack.length / 1000).toFixed(2) + 'm');
  console.log('   平均横截面填充 ' + (avg * 100).toFixed(0) + '%  最空一片 ' + (min * 100).toFixed(0) +
    '%  第一米最空 ' + (Math.min(...firstMeter) * 100).toFixed(0) + '%');
  rows.slice(0, 12).forEach((r) => {
    console.log('   x=' + String(Math.round(r.x)).padStart(5) + 'mm ' + (r.fill * 100).toFixed(0).padStart(3) + '% ' + bar(r.fill));
  });
}

const c = C.get('40HQ');
// 关键场景：大箱 fy=1100 时 ny=1，一排只用掉 1100/2352 的宽度；
// 小箱要能填掉剩下的 1252mm，才能满足"第一排装满再装下一排"
const bigRect = { id: 'a', shape: 'rect', name: '大箱', qty: '10', values: { L: 2400, W: 1100, H: 1300 }, allowFlip: true, allowSide: true };
const small = { id: 'b', shape: 'rect', name: '小箱', qty: '30', values: { L: 600, W: 400, H: 400 }, allowFlip: true, allowSide: true };

summary('混装 L 2300×940 + 小箱', P.runColumnMix([
  { id: 'a', shape: 'lshape', name: 'L形', qty: '20', values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 }, allowFlip: true, allowSide: true },
  { id: 'b', shape: 'rect', name: '小箱', qty: '100', values: { L: 600, W: 400, H: 400 }, allowFlip: true, allowSide: true }
], c), c);

console.log('');
summary('大箱 2400×1100×1300 + 小箱', P.runColumnMix([bigRect, small], c), c);

console.log('');
summary('主引擎 大箱 + 小箱', P.run({ container: c, rows: [bigRect, small], options: {} }), c);
