/*
 * 贴面落位单测：坐落到支撑面（面接触）+ 角对齐 + 零侵入。
 *   node tests/place-on-face.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const SOLID = require('../js/core/solid.js');
const L = require('../js/core/corner-link.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const rect = (id, l, w, h) => ({ id, shape: 'rect', shapeValues: { l, w, h }, bbox: { l, w, h } });
const box = (skuId, x, y, z, l, w, h, uid) => ({ skuId, x, y, z, l, w, h, uid: uid || skuId });

console.log('\n贴面落位');

test('悬在 60mm 高处松手：坐到下件顶面，缝 gap=0，面接触 100%', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const b = box('a', 0, 0, 360, 400, 300, 300, 'B1');   // 故意浮 60mm
  const r = L.placeOnFace(b, [a], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 300, '必须坐到 300 的面上，实际 ' + r.box.z);
  assert.strictEqual(r.gap, 0, 'gap 必须是 0，实际 ' + r.gap);
  assert.strictEqual(r.contact.ratio, 1, '面接触应 100%，实际 ' + r.contact.ratio);
});

test('水平偏 40mm：角对齐到支撑面的角，残差为 0', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const b = box('a', 37, 28, 320, 400, 300, 300, 'B1');
  const r = L.placeOnFace(b, [a], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y, r.box.z], [0, 0, 300]);
  assert.ok(r.aligned.moved, '应发生角对齐');
  assert.deepStrictEqual([r.aligned.dx, r.aligned.dy], [-37, -28]);
});

test('旁边有更高的箱子：不穿进去，而是站到更高的那一层（零侵入优先）', () => {
  const items = { a: rect('a', 400, 300, 300), b: rect('b', 400, 300, 600) };
  const a = box('a', 0, 0, 0, 400, 300, 300, 'A1');
  const nb = box('b', 0, 400, 0, 400, 300, 600, 'B1');
  const drop = box('a', 0, 200, 500, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, [a, nb], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 600, '应抬到 600 而不是压在 300 上穿进 B1，实际 ' + r.box.z);
  [a, nb].forEach((o) => {
    const depth = SOLID.overlapDepth(r.box, o, items.a, items.b, 10);
    assert.ok(depth <= 1, '与 ' + o.uid + ' 侵入 ' + depth.toFixed(1) + 'mm');
  });
});

test('对齐后出柜：拒绝', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const a = box('a', c.innerL - 20, 0, 0, 400, 300, 300, 'A1');
  const drop = box('a', c.innerL - 30, 0, 300, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, [a], c, items, { tol: 150 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bounds', '实际 ' + r.reason);
});

test('脚下什么都没有：落到柜底 z=0', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const b = box('a', 2000, 1000, 800, 400, 300, 300, 'B1');
  const r = L.placeOnFace(b, [], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 0);
  assert.strictEqual(r.floor, true);
});

test('落位后与所有箱子逐只采样零侵入', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const placed = [
    box('a', 0, 0, 0, 400, 300, 300, 'A1'),
    box('a', 400, 0, 0, 400, 300, 300, 'A2')
  ];
  const drop = box('a', 380, 0, 700, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, placed, c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  placed.forEach((o) => {
    const depth = SOLID.overlapDepth(r.box, o, items.a, items.a, 10);
    assert.ok(depth <= 1, '与 ' + o.uid + ' 侵入 ' + depth.toFixed(1) + 'mm');
  });
});

test('箱高超过柜门：直接拒绝，不要绕到"没支撑"', () => {
  const items = { a: rect('a', 400, 300, 2700) };
  const b = box('a', 0, 0, 0, 400, 300, 2700, 'B1');
  const r = L.placeOnFace(b, [], c, items, { tol: 150 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'door-height');
});

test('不同尺寸叠放：小箱落在大箱顶面，至少一条边自动贴齐（不是含糊的偏移）', () => {
  const items = { big: rect('big', 800, 600, 400), sm: rect('sm', 300, 300, 300) };
  const big = box('big', 0, 0, 0, 800, 600, 400, 'G1');
  const drop = box('sm', 500, 350, 300, 300, 300, 300, 'S1');
  const r = L.placeOnFace(drop, [big], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 400);
  assert.strictEqual(r.box.y, 300, '右边贴齐：y + 箱宽 300 应等于 600，实际 ' + r.box.y);
  assert.ok(r.aligned.moved, '必须发生边对齐');
});

test('落在很大的支撑面中间：不强制贴边（贴边会让拖动时乱跳）', () => {
  const items = { big: rect('big', 2000, 1000, 400), sm: rect('sm', 300, 300, 300) };
  const big = box('big', 0, 0, 0, 2000, 1000, 400, 'G1');
  const drop = box('sm', 850, 350, 300, 300, 300, 300, 'S1');
  const r = L.placeOnFace(drop, [big], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y], [850, 350], '应保持放下时的位置');
  assert.strictEqual(r.aligned.moved, false, '不该强行贴边');
});

test('小箱几乎盖满支撑面：至少贴到支撑面的一条边（位置确定）', () => {
  const items = { big: rect('big', 400, 300, 300), sm: rect('sm', 380, 280, 300) };
  const big = box('big', 0, 0, 0, 400, 300, 300, 'G1');
  const drop = box('sm', 13, 11, 300, 380, 280, 300, 'S1');
  const r = L.placeOnFace(drop, [big], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  const flushX = Math.abs(r.box.x) < 0.001 || Math.abs(r.box.x + 380 - 400) < 0.001;
  const flushY = Math.abs(r.box.y) < 0.001 || Math.abs(r.box.y + 280 - 300) < 0.001;
  assert.ok(flushX, 'x 应贴住支撑面的某条边，实际 ' + r.box.x);
  assert.ok(flushY, 'y 应贴住支撑面的某条边，实际 ' + r.box.y);
  assert.ok(r.aligned.moved, '应发生贴边');
});

test('只有柜底时不做无底线吸附：落点保持原样', () => {
  const items = { sm: rect('sm', 300, 300, 300) };
  const drop = box('sm', 1000, 500, 0, 300, 300, 300, 'S1');
  const r = L.placeOnFace(drop, [], c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.deepStrictEqual([r.box.x, r.box.y], [1000, 500]);
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
