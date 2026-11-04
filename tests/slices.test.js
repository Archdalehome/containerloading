/*
 * 按切片装柜：一片装满（横向铺满 + 堆到顶）再挪下一片。
 *   node tests/slices.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + e.message); }
}

const c = C.get('40HQ');
const row = (id, shape, values, qty) => ({ id, shape, name: id, values, qty, allowFlip: true, allowSide: true });
const extent = (pk) => ({
  len: Math.max.apply(null, pk.placements.map((p) => p.x + p.l)),
  wid: Math.max.apply(null, pk.placements.map((p) => p.y + p.w)),
  high: Math.max.apply(null, pk.placements.map((p) => p.z + p.h))
});

console.log('\n按切片装柜');

test('50 只斜顶 600×400（300/500）：全装下，柜长只占 1.2m，堆到 2.4m 高', () => {
  const pk = P.runSlices({
    container: c,
    rows: [row('a', 'slope', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 50)],
    options: {}
  });
  assert.ok(pk, '应有结果');
  assert.strictEqual(pk.placements.length, 50, '应全部装下，实际 ' + pk.placements.length);
  const e = extent(pk);
  assert.ok(e.len <= 1300, '柜长方向应只占一片多一点，实际 ' + Math.round(e.len));
  assert.ok(e.high >= 2000, '应堆到 2 米以上，实际 ' + Math.round(e.high));
  assert.strictEqual((P.validatePhysics(pk) || []).length, 0, '物理校验应零错误');
});

test('10 只 L 形 600×700（不对称台阶）：两两对扣，两片装完', () => {
  const pk = P.runSlices({
    container: c,
    rows: [row('b', 'lshape', { L: '600', W: '700', Wlow: '460', Whigh: '240', Hlow: '300', Hhigh: '500' }, 10)],
    options: {}
  });
  assert.ok(pk, '应有结果');
  assert.strictEqual(pk.placements.length, 10);
  const e = extent(pk);
  // 不对称台阶扣完顶面不平，一片只放一层对扣，所以 10 只要两片（1200mm）
  assert.ok(e.len <= 1300, '应只占两片，实际 ' + Math.round(e.len));
  assert.ok(e.high >= 700, '应做对扣（拼合高 800），实际 ' + Math.round(e.high));
  assert.strictEqual((P.validatePhysics(pk) || []).length, 0);
});

test('矩形 400×300×300 ×100：柜长占 1m 内，堆到 2.4m', () => {
  const pk = P.runSlices({
    container: c,
    rows: [row('c', 'rect', { L: '400', W: '300', H: '300' }, 100)],
    options: {}
  });
  assert.ok(pk, '应有结果');
  assert.strictEqual(pk.placements.length, 100);
  const e = extent(pk);
  assert.ok(e.len <= 1000, '实际 ' + Math.round(e.len));
  assert.ok(e.high >= 2000, '实际 ' + Math.round(e.high));
  assert.strictEqual((P.validatePhysics(pk) || []).length, 0);
});

test('装不下的会如实报剩余，不会超装', () => {
  const pk = P.runSlices({
    container: c,
    rows: [row('c', 'rect', { L: '400', W: '300', H: '300' }, 5000)],
    options: {}
  });
  assert.ok(pk);
  assert.strictEqual(pk.placements.length, pk.totals.loadedCount);
  assert.ok(pk.totals.loadedCount <= 5000);
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败\n');
if (fail) process.exit(1);
