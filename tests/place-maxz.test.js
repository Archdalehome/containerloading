/*
 * maxZ（拖动中用滚轮把箱子往下放）单测。
 *   node tests/place-maxz.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const L = require('../js/core/corner-link.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const rect = (id, l, w, h) => ({ id, shape: 'rect', shapeValues: { l, w, h }, bbox: { l, w, h } });
const box = (skuId, x, y, z, l, w, h, uid) => ({ skuId, x, y, z, l, w, h, uid: uid || skuId });

console.log('\n落点高度上限 maxZ');

test('不设 maxZ：吸到最高的那一层（旧行为）', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const placed = [
    box('a', 0, 0, 0, 400, 300, 300, 'A1'),
    box('a', 0, 0, 600, 400, 300, 300, 'A2')   // 悬在上方的那只（测试用，正好卡住最高层）
  ];
  const drop = box('a', 0, 0, 0, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, placed, c, items, { tol: 150 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 900, '应落到最上面一层 900，实际 ' + r.box.z);
});

test('maxZ=400：压到 300 那一层，不再被吸到 900', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const placed = [
    box('a', 0, 0, 0, 400, 300, 300, 'A1'),
    box('a', 0, 0, 600, 400, 300, 300, 'A2')
  ];
  const drop = box('a', 0, 0, 0, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, placed, c, items, { tol: 150, maxZ: 400 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 300, '应落在 300，实际 ' + r.box.z);
});

test('maxZ 压到很低：可以落到柜底', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const placed = [box('a', 0, 0, 0, 400, 300, 300, 'A1')];
  const drop = box('a', 900, 0, 0, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, placed, c, items, { tol: 150, maxZ: 0 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 0);
  assert.strictEqual(r.floor, true);
});

test('maxZ 太低但脚下只有更高的面：落到柜底而不是硬塞', () => {
  const items = { a: rect('a', 400, 300, 300) };
  const placed = [box('a', 0, 0, 300, 400, 300, 300, 'A1')];   // 只有 600 这一层可用
  const drop = box('a', 0, 0, 0, 400, 300, 300, 'D1');
  const r = L.placeOnFace(drop, placed, c, items, { tol: 150, maxZ: 100 });
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.box.z, 0, '实际 ' + r.box.z);
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
