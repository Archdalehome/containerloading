/*
 * 列最优（含对扣块）的回归测试。
 *
 * 这一组数字是用户实测反馈逼出来的：L 形 2300×940 在 40HQ 里 30 只，
 * 原来算出 9.40m，用户看图说"把最后一排叠起来并转一个方向"会短很多——
 * 正确的 7.52m 要靠"转 90° 横着装 + 一正一倒对扣成平顶块"。
 *
 * 同时锁死两个曾经错过的点：
 *   1. 正放的 L 形/斜顶顶面不平，普通列不许往上叠（之前叠 4 层，全是悬空）
 *   2. 柜长上限：dp 只算"恰好 k 只用多长"，不约束柜内长，会给出 25m 装进 12m 柜的方案，
 *      而 validatePhysics 不查越界
 *
 *   node tests/columns.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');

const c40 = C.get('40HQ');

function lshapeRows(qty) {
  return [{
    id: 'r1', shape: 'lshape', name: 'L形箱', qty: String(qty),
    values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 },
    allowFlip: true, allowSide: true
  }];
}

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

// 用户那单的六个数量：柜长 + 物理校验 0 错误
ok('L 形 2300×940 各数量：柜长正确且物理校验 0 错误', () => {
  const want = { 3: 0.94, 5: 1.88, 10: 2.82, 15: 3.76, 20: 4.70, 30: 7.52, 40: 9.40 };
  Object.keys(want).forEach((q) => {
    const pk = P.optimalColumns(lshapeRows(Number(q)), c40);
    assert.ok(pk, q + ' 只应该有解');
    assert.strictEqual(pk.totals.loadedCount, Number(q), q + ' 只应当全部装入');
    assert.ok(Math.abs(pk.length / 1000 - want[q]) < 0.005,
      q + ' 只柜长应为 ' + want[q] + 'm，实际 ' + (pk.length / 1000).toFixed(2) + 'm');
    const errs = P.validatePhysics(pk);
    assert.strictEqual(errs.length, 0, q + ' 只物理校验应 0 错误，实际 ' + JSON.stringify(errs.slice(0, 2).map((e) => e.code)));
  });
});

ok('30 只确实比主引擎的 9.40m 短（横装 + 对扣的收益）', () => {
  const oc = P.optimalColumns(lshapeRows(30), c40);
  const ref = P.run({ container: c40, rows: lshapeRows(30), options: {} });
  let refLen = 0;
  ref.placements.forEach((p) => { refLen = Math.max(refLen, p.x + p.l); });
  assert.ok(oc.totals.loadedCount >= ref.totals.loadedCount, '列最优不能比主引擎装得少');
  assert.ok(oc.length < refLen - 1, '列最优柜长 ' + oc.length + ' 应短于主引擎 ' + refLen);
});

ok('开柜长上限：20GP 里 30 只必须只放装得下的数量，不许越界', () => {
  const c20 = C.get('20GP');
  const pk = P.optimalColumns(lshapeRows(30), c20);
  assert.ok(pk, '20GP 应有解');
  assert.ok(pk.length <= c20.innerL + 1, '柜长 ' + pk.length + ' 超过 20GP 内长 ' + c20.innerL);
  assert.ok(pk.totals.loadedCount < 30, '20GP 装不下 30 只，应少装');
  assert.strictEqual(P.validatePhysics(pk).length, 0);
});

ok('斜顶 600×400 对扣块 + 顶部单只：高度要用满，物理校验 0 错误', () => {
  const rows = [{
    id: 's1', shape: 'slope', name: '斜顶箱', qty: '50',
    values: { L: 600, W: 400, Hlow: 300, Hhigh: 500 }, allowFlip: true, allowSide: true
  }];
  const pk = P.optimalColumns(rows, c40);
  assert.ok(pk);
  assert.strictEqual(pk.totals.loadedCount, 50);
  assert.strictEqual(P.validatePhysics(pk).length, 0, '物理校验必须 0 错误');
  const usedH = pk.placements.reduce((m, p) => Math.max(m, p.z + p.h), 0);
  assert.ok(usedH <= c40.innerH, '用高 ' + usedH + ' 超过内高 ' + c40.innerH);
});

ok('矩形箱列最优不劣于主引擎（同箱数下柜长更短或持平）', () => {
  const rows = [{ id: 'a', shape: 'rect', name: 'A', qty: '200', values: { L: 600, W: 400, H: 400 } }];
  const oc = P.optimalColumns(rows, c40);
  const ref = P.run({ container: c40, rows: rows, options: {} });
  assert.strictEqual(oc.totals.loadedCount, 200, '矩形 600×400×400 应能全部装入 40HQ');
  assert.strictEqual(P.validatePhysics(oc).length, 0);
  let refLen = 0;
  ref.placements.forEach((p) => { refLen = Math.max(refLen, p.x + p.l); });
  assert.ok(oc.length <= Math.max(refLen, ref.totals.loadedCount) + 1,
    '列最优柜长 ' + oc.length + ' 不应比主引擎 ' + refLen + ' 长出太多');
});

console.log('\n' + pass + ' 通过，0 失败\n');
