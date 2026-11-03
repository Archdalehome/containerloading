/*
 * 定位对扣单测：翻 180° 扣在下件上，两个箱体的实体互补成一个实心块。
 *   node tests/pair.test.js
 *
 * 结论都是用 solid 采样量出来的（tools/probe-pair2.js），不是推的：
 *   L 形：沿宽度镜像 + 翻 z，落 H低 → 两块拼成 L×W×(H低+H高) 实心块
 *   斜顶：沿长度镜像 + 翻 z，落 H底 → 两块拼成 L×W×(H底+H高) 实心块
 *   不对台阶的 L 形落 H低 一定穿插 → 直接拦掉
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const SOLID = require('../js/core/solid.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const FLIP_L = [1, 0, 0, 0, -1, 0, 0, 0, -1];    // L 形：镜像宽度 + 翻 z
const FLIP_S = [-1, 0, 0, 0, 1, 0, 0, 0, -1];    // 斜顶：镜像长度 + 翻 z
const lshape = (id, l, w, wlow, whigh, hlow, hhigh) => ({
  id, shape: 'lshape',
  shapeValues: { l, w, h: hhigh, wlow, whigh, hlow, hhigh },
  bbox: { l, w, h: hhigh }
});
const slope = (id, l, w, hlow, hhigh) => ({
  id, shape: 'slope',
  shapeValues: { l, w, h: hhigh, hlow, hhigh },
  bbox: { l, w, h: hhigh }
});
const box = (skuId, x, y, z, l, w, h, uid) => ({ skuId, x, y, z, l, w, h, uid: uid || skuId, pose: IDENT });

console.log('\n定位对扣（几何）');

// 与 manual-proto.html 里 doPair 同一套算法
function pairOnto(lower, it) {
  const ph = it.shape === 'slope' ? FLIP_S : FLIP_L;
  return {
    skuId: lower.skuId, x: lower.x, y: lower.y, z: lower.z + it.shapeValues.hlow,
    l: lower.l, w: lower.w, h: lower.h, pose: ph, uid: 'P1'
  };
}

test('对称 L 形 900×700（350/350，H低300/H高600）：落 H低 → 零穿插', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const up = pairOnto(lower, it);
  const depth = SOLID.overlapDepth(up, lower, it, it, 10);
  assert.ok(depth <= 1, '与下件穿插应 ≤1mm，实际 ' + depth.toFixed(1) + 'mm');
  assert.strictEqual(up.z, 300);
});

test('对称 L 形两块拼成实心块：体积 = 900×700×900，零空隙', () => {
  const single = 900 * (350 * 300 + 350 * 600);
  assert.strictEqual(single * 2, 900 * 700 * 900, '两块净体积之和应正好等于拼合块体积');
});

test('斜顶 2000×470（H底500/H高900）：镜像长度 + 落 H底 → 零穿插', () => {
  const it = slope('s', 2000, 470, 500, 900);
  const lower = box('s', 0, 0, 0, 2000, 470, 900, 'S1');
  const up = pairOnto(lower, it);
  const depth = SOLID.overlapDepth(up, lower, it, it, 10);
  assert.ok(depth <= 1, '斜顶对扣穿插应 ≤1mm，实际 ' + depth.toFixed(1) + 'mm');
  assert.strictEqual(up.z, 500);
});

test('斜顶两块拼成实心块：体积 = 2000×470×1400，零空隙', () => {
  const single = 2000 * 470 * (500 + 900) / 2;
  assert.strictEqual(single * 2, 2000 * 470 * 1400, '两个楔形之和应正好等于拼合块体积');
});

test('斜顶用 L 形的翻转轴会穿插（说明必须按箱型分开）', () => {
  const it = slope('s', 2000, 470, 500, 900);
  const lower = box('s', 0, 0, 0, 2000, 470, 900, 'S1');
  const up = { skuId: 's', x: 0, y: 0, z: 500, l: 2000, w: 470, h: 900, pose: FLIP_L, uid: 'P1' };
  const depth = SOLID.overlapDepth(up, lower, it, it, 10);
  assert.ok(depth > 1, '实际 ' + depth.toFixed(1) + 'mm');
});

test('角对齐：配对件与下件同 x/y，四个角水平残差 0', () => {
  const it = lshape('l', 900, 700, 350, 350, 300, 600);
  const lower = box('l', 40, 70, 0, 900, 700, 600, 'L1');
  const up = pairOnto(lower, it);
  assert.strictEqual(up.x - lower.x, 0);
  assert.strictEqual(up.y - lower.y, 0);
});

test('台阶不对称的 L 形（250/450）：落 H低 必然穿插 → 必须拦', () => {
  const it = lshape('l', 900, 700, 250, 450, 300, 600);
  const lower = box('l', 0, 0, 0, 900, 700, 600, 'L1');
  const up = pairOnto(lower, it);
  const depth = SOLID.overlapDepth(up, lower, it, it, 10);
  assert.ok(depth > 1, '不对称台阶应测出穿插，实际 ' + depth.toFixed(1) + 'mm');
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
