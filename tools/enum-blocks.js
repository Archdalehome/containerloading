/*
 * 块枚举（侧倒互补块 + 竖直对扣块），判定器已用 90 箱竖直对扣校准（0 重叠 0 空洞）。
 *   node tools/calib-block.js 之后跑这个
 */
'use strict';
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const SOLID = require('../js/core/solid.js');

function judge(lower, upper, item, T, step) {
  const x0 = Math.min(lower.x, upper.x);
  const y0 = Math.min(lower.y, upper.y);
  const x1 = Math.max(lower.x + lower.l, upper.x + upper.l);
  const y1 = Math.max(lower.y + lower.w, upper.y + upper.w);
  const nx = Math.max(1, Math.ceil((x1 - x0) / (step || 25)));
  const ny = Math.max(1, Math.ceil((y1 - y0) / (step || 25)));
  let cols = 0, holes = 0, overlaps = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const X = x0 + (i + 0.5) * (x1 - x0) / nx;
      const Y = y0 + (j + 0.5) * (y1 - y0) / ny;
      const a = SOLID.spanAt(lower, item, X, Y);
      const b = SOLID.spanAt(upper, item, X, Y);
      cols++;
      if (!a && !b) { holes++; continue; }
      const lo = Math.min(a ? a[0] : Infinity, b ? b[0] : Infinity);
      const hi = Math.max(a ? a[1] : -Infinity, b ? b[1] : -Infinity);
      if (Math.abs(lo) > 1 || Math.abs(hi - T) > 1) holes++;
      if (a && b) {
        const ov = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
        if (ov > 1) overlaps++;
      }
    }
  }
  return { L: x1 - x0, W: y1 - y0, T, cols, holes, overlaps };
}

const AXIS_ROT = [
  [1, -1, -1],  // 绕容器 X 轴 180°
  [-1, 1, -1],  // 绕 Y 轴
  [-1, -1, 1]   // 绕 Z 轴
];

/** 在给定的下件姿态上枚举「yaw 180°」，找并集为实心长方体的块 */
function findBlocks(item, pose, netEach, step) {
  const out = [];
  // yaw 180°：绕容器竖直轴（Z）转 180°，只取反每个局部轴在 X/Y 上的分量，
  // 竖直分量不变 → 第二只保持同一个「侧躺」姿态，楔形在水平面内互补。
  const m = pose.m.slice();
  for (let a = 0; a < 3; a++) {
    m[0 * 3 + a] = -m[0 * 3 + a];
    m[1 * 3 + a] = -m[1 * 3 + a];
  }
  const up = SOLID.poseFromMatrix(m);
  // 上件的外廓与下件相同（yaw 不改变尺寸），不能再回查 posesFor——那边按尺寸去重会取错
  const ul = pose.fx, uw = pose.fy, uh = pose.thickness;
  for (let dx = 0; dx <= 900; dx += 50) {
    for (let dy = 0; dy <= 900; dy += 50) {
      if (dx === 0 && dy === 0) continue;
      const lower = { x: 0, y: 0, z: 0, l: pose.fx, w: pose.fy, h: pose.thickness, pose: pose.m };
      const upper = { x: dx, y: dy, z: 0, l: ul, w: uw, h: uh, pose: up.m };
      const T = Math.max(pose.thickness, uh);
      const r = judge(lower, upper, item, T, step);
      const vol = r.L * r.W * r.T;
      if (Math.abs(vol - 2 * netEach) < 1e6 && process.env.DBG) {
        console.log('   [候选] dx=%s dy=%s → %s×%s×%s 空洞 %s/%s 重叠 %s/%s',
          dx, dy, r.L, r.W, r.T, r.holes, r.cols, r.overlaps, r.cols);
      }
      if (r.holes === 0 && r.overlaps === 0 && Math.abs(vol - 2 * netEach) < 1e6) {
        out.push({ L: r.L, W: r.W, T: r.T, upper: { dx, dy, dz: 0, m: up.m }, yaw: true, lum: pose.m });
      }
    }
  }
  return out;
}

const c = C.get('40HQ');
const row = { id: 'b', shape: 'slope', name: '', values: { L: '700', W: '700', Hlow: '300', Hhigh: '600' }, qty: '190', weight: '', allowSide: true, allowFlip: true };
const pk = P.run({ container: c, rows: [row], options: {} });
const it = pk.items[0];
const netEach = 700 * 700 * 450; // (H低+H高)/2 × 底
const seen = new Set();
const blocks = [];
/* 「侧躺」= 箱子以楔形剖面着地，等价于**局部 W 轴竖直**（vertical === 1）。
 * 不能只看「厚度 = 700」：厚度相同的姿态里有些是把箱子立在侧面，剖面仍在竖直方向，
 * 对它做 yaw 180° 形状不变，两只箱子只会同向错开、叠出 300mm 重叠带。 */
P.posesFor(it).forEach((pose) => {
  if (pose.flip) return;
  if (pose.vertical !== 1) return;
  findBlocks(it, pose, netEach, 25).forEach((b) => {
    const k = [b.L, b.W, b.T].join('x');
    if (seen.has(k)) return;
    seen.add(k);
    blocks.push(Object.assign({ pose }, b));
  });
});

console.log('斜顶 700×700（300/600）在 40HQ 的 2 箱块：');
blocks.forEach((b) => {
  const nx1 = Math.floor(c.innerL / b.L), ny1 = Math.floor(c.innerW / b.W);
  const nx2 = Math.floor(c.innerL / b.W), ny2 = Math.floor(c.innerW / b.L);
  const per1 = nx1 * ny1 * 2, per2 = nx2 * ny2 * 2;
  const bestN = Math.max(per1, per2);
  console.log('  块 %s×%s×%s · 竖直姿态 t=%s · 朝向A %s×%s=%s 箱/层（%s 箱/mm）· 朝向B %s×%s=%s 箱/层（%s 箱/mm）',
    b.L, b.W, b.T, b.pose.thickness,
    nx1, ny1, per1, (per1 / b.T).toFixed(4),
    nx2, ny2, per2, (per2 / b.T).toFixed(4));
  console.log('    上件位移 dx=%s dy=%s dz=%s · 每层最多 %s 箱（每毫米 %s）',
    b.upper.dx, b.upper.dy, b.upper.dz, bestN, (bestN / b.T).toFixed(4));
});
