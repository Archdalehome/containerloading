/* 临时探针：侧倒互补块 vs 竖直对扣块 —— 尺寸、箱数、每层个数、密度 */
'use strict';
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const SOLID = require('../js/core/solid.js');

const c = C.get('40HQ');
const row = { id: 'b', shape: 'slope', name: '', values: { L: '700', W: '700', Hlow: '300', Hhigh: '600' }, qty: '190', weight: '', allowSide: true, allowFlip: true };
const pk = P.run({ container: c, rows: [row], options: {} });
const it = pk.items[0];
const sv = it.shapeValues;

/* 采样判：两只箱子的并集是否等于实心长方体（每列实体从 0 连续到 T，无重叠、无空洞） */
function solidBlock(lower, upper, T, step) {
  const L = Math.max(lower.l, upper.x + upper.l);
  const W = Math.max(lower.w, upper.y + upper.w);
  const nx = Math.ceil(L / step), ny = Math.ceil(W / step);
  let holes = 0, overlaps = 0, cells = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const X = (i + 0.5) * L / nx, Y = (j + 0.5) * W / ny;
      const a = SOLID.spanAt(lower, it, X, Y);
      const b = SOLID.spanAt(upper, it, X, Y);
      if (!a && !b) { holes++; continue; }
      cells++;
      if (a && b) {
        const ov = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
        if (ov > 1) overlaps++;
      }
      const lo = Math.min(a ? a[0] : Infinity, b ? b[0] : Infinity);
      const hi = Math.max(a ? a[1] : -Infinity, b ? b[1] : -Infinity);
      if (Math.abs(lo) > 1 || Math.abs(hi - T) > 1) holes++;
      if (a && b) {
        const ov2 = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
        if (Math.max(a[1], b[1]) - Math.min(a[0], b[0]) - Math.max(0, ov2) > 1) holes++;
      }
    }
  }
  return { L, W, T, cells, holes, overlaps: overlaps, ok: holes === 0 && overlaps === 0 };
}

/* 侧躺互补块：竖直方向 = 箱宽 700，两只绕竖直轴翻转 180°，沿剖面方向错开 H高−H低 */
const sidePose = P.posesFor(it).find((p) => p.thickness === 700 && p.fx === 700 && p.fy === 600);
if (!sidePose) throw new Error('找不到侧躺姿态');
const flipM = sidePose.m.slice();
for (let r = 0; r < 3; r++) { flipM[r * 3 + 0] = -flipM[r * 3 + 0]; flipM[r * 3 + 1] = -flipM[r * 3 + 1]; }
const up = SOLID.poseFromMatrix(flipM);
const lower = { x: 0, y: 0, z: 0, l: sidePose.fx, w: sidePose.fy, h: sidePose.thickness, pose: sidePose.m };
const upper = { x: 0, y: sv.hhigh - sv.h, z: 0, l: 600, w: 700, h: 700, pose: up.m };
// 侧躺后水平面的梯形沿着 600 那条边摊开，两块错开 (H高−H低) 正好互补
upper.y = 0;
upper.x = sv.hhigh - sv.hlow; // 300
const side = solidBlock(lower, upper, 700, 20);
console.log('侧倒互补块：底面 %s×%s，高 %s，箱数 2', side.L, side.W, side.T);
console.log('  采样：列 %s，空洞 %s，重叠 %s → %s', side.cells, side.holes, side.overlaps, side.ok ? '实心' : '不成立');
const sideNx = Math.floor(c.innerL / side.L), sideNy = Math.floor(c.innerW / side.W);
console.log('  每层 %s×%s = %s 块 = %s 箱，每毫米 %s 箱',
  sideNx, sideNy, sideNx * sideNy, sideNx * sideNy * 2, ((sideNx * sideNy * 2) / side.T).toFixed(4));

/* 竖直对扣块：底面 700×700，高 H低+H高 = 900 */
const up2 = P.findFlipPose(it, P.posesFor(it).find((p) => p.vertical === 2 && p.fx === 700));
const vp = { x: 0, y: 0, z: 0, l: 700, w: 700, h: 600, pose: P.posesFor(it).find((p) => p.vertical === 2 && p.fx === 700).m };
const vpU = { x: 0, y: 0, z: 300, l: 700, w: 700, h: 600, pose: up2.m };
const vert = solidBlock(vp, vpU, 900, 20);
console.log('竖直对扣块：底面 %s×%s，高 %s，箱数 2', vert.L, vert.W, vert.T);
console.log('  采样：列 %s，空洞 %s，重叠 %s → %s', vert.cells, vert.holes, vert.overlaps, vert.ok ? '实心' : '不成立');
const vNx = Math.floor(c.innerL / vert.L), vNy = Math.floor(c.innerW / vert.W);
console.log('  每层 %s×%s = %s 块 = %s 箱，每毫米 %s 箱',
  vNx, vNy, vNx * vNy, vNx * vNy * 2, ((vNx * vNy * 2) / vert.T).toFixed(4));
