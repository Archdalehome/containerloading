/*
 * 手动装柜逻辑层单测：沉降 / 贴齐 / 拒绝落位 / 旋转。
 *   node tests/manual.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const M = require('../js/core/manual.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const itemsById = {
  a: { id: 'a', shape: 'rect', shapeValues: { l: 400, w: 300, h: 300 }, bbox: { l: 400, w: 300, h: 300 } }
};
const mk = (x, y, z, l, w, h) => ({ skuId: 'a', x, y, z, l: l || 400, w: w || 300, h: h || 300 });

console.log('\n手动装柜逻辑层');

test('沉降：柜底空柜时落到 z=0', () => {
  const r = M.tryPlace(mk(100, 100, 900), [], c, itemsById);
  assert.ok(r.ok);
  assert.strictEqual(r.box.z, 0, '应沉到柜底，实际 ' + r.box.z);
});

test('沉降：落在一只箱顶上，z 等于其顶面高度', () => {
  const placed = [mk(0, 0, 0)];
  const r = M.tryPlace(mk(0, 0, 2000), placed, c, itemsById);
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 300, '应停在 300mm，实际 ' + r.box.z);
});

test('贴齐：50mm 内吸到后壁，误差归零', () => {
  const r = M.tryPlace(mk(37, 33, 0), [], c, itemsById);
  assert.ok(r.ok);
  assert.strictEqual(r.box.x, 0, 'x 应贴 0，实际 ' + r.box.x);
  assert.strictEqual(r.box.y, 0, 'y 应贴 0，实际 ' + r.box.y);
  assert.ok(r.snaps.length >= 2);
});

test('贴齐：超过 50mm 不吸（保持原位）', () => {
  const r = M.tryPlace(mk(80, 80, 0), [], c, itemsById);
  assert.ok(r.ok);
  assert.strictEqual(r.box.x, 80, 'x 不该被吸，实际 ' + r.box.x);
  assert.strictEqual(r.box.y, 80);
});

test('拒绝：越界（超出柜宽）', () => {
  const r = M.tryPlace(mk(0, c.innerW - 100, 0), [], c, itemsById);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bounds');
});

test('拒绝：与已有箱体重叠（贴齐范围外，仍压在低位）', () => {
  const placed = [mk(0, 0, 0)];
  const r = M.tryPlace(mk(100, 100, 0), placed, c, itemsById);
  assert.strictEqual(r.ok, false, '重叠必须拒绝，实际 ok=' + r.ok);
  assert.strictEqual(r.reason, 'overlap');
});

test('低位放不稳也只会沉到柜底，不会悬空', () => {
  const placed = [mk(0, 0, 0, 100, 100, 300)]; // 100×100 的小箱托不住 400×300
  const r = M.tryPlace(mk(0, 0, 300), placed, c, itemsById);
  assert.ok(r.box.z === 0 || r.reason === 'overlap', '应沉到柜底或与底部箱重叠，实际 ' + r.reason + ' z=' + r.box.z);
  assert.notStrictEqual(r.reason, 'no-support', '柜底总能托住，不该报无支撑');
});

test('三轴旋转各 90°：外廓体积不变，三轴各换一次', () => {
  const b = mk(0, 0, 0, 400, 300, 200);
  const rx = M.rotate90(b, 'x');
  const ry = M.rotate90(b, 'y');
  const rz = M.rotate90(b, 'z');
  [[b, rx, 'x'], [b, ry, 'y'], [b, rz, 'z']].forEach(([o, r]) => {
    assert.strictEqual(o.l * o.w * o.h, r.l * r.w * r.h, '体积应不变');
  });
  assert.deepStrictEqual([rx.l, rx.w, rx.h], [400, 200, 300]);
  assert.deepStrictEqual([ry.l, ry.w, ry.h], [200, 300, 400]);
  assert.deepStrictEqual([rz.l, rz.w, rz.h], [300, 400, 200]);
});

test('旋转后固定顺序：旋转 → 沉降 → 判定，不合法退回原姿态', () => {
  const b = mk(0, 0, 0, 400, 300, 200);
  const ok = M.rotateAndPlace(b, [], c, itemsById, 'y');
  assert.ok(ok.ok);
  assert.strictEqual(ok.box.h, 400, '绕 y 转后高应变 400，实际 ' + ok.box.h);
  assert.strictEqual(ok.box.z, 0);
  // 门高高不过：转成 2600 高应被拒绝并退回原姿态
  const tall = mk(0, 0, 0, 400, 300, 2600);
  const bad = M.rotateAndPlace(tall, [], c, itemsById, 'x');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.box.h, 2600, '失败时必须退回原姿态');
});

console.log('\n' + pass + ' 通过，' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
