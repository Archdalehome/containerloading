/*
 * M1 核心逻辑自检（Node，无需浏览器）：
 *   node tests/core.test.js
 * 只测纯逻辑：体积、外接尺寸、校验规则。UI 交互用 tools/browser-check.mjs。
 */
'use strict';

const assert = require('assert');
const init = require('../js/core/init.js');
const S = init.shapes;
const V = init.validate;
const C = init.containers;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures.push({ name, error: e });
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

function close(a, b, msg) {
  assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ' got ' + a);
}

console.log('\n体积与几何');

test('矩形箱 400×300×300 = 0.036 m³', () => {
  const v = { L: '400', W: '300', H: '300' };
  close(S.get('rect').volume(v), 36e6);
  const b = S.get('rect').bbox(v);
  assert.deepStrictEqual([b.l, b.w, b.h], [400, 300, 300]);
});

test('L形箱 600×400，前段 160×300、后段 240×500 = 0.1008 m³', () => {
  const v = { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' };
  close(S.get('lshape').volume(v), 100.8e6);
  const b = S.get('lshape').bbox(v);
  assert.deepStrictEqual([b.l, b.w, b.h], [600, 400, 500]);
  close(S.fillRatio('lshape', v), 0.84);
});

test('斜顶箱 600×400，300→500 = 0.096 m³，外接高取 H高', () => {
  const v = { L: '600', W: '400', Hlow: '300', Hhigh: '500' };
  close(S.get('slope').volume(v), 96e6);
  const b = S.get('slope').bbox(v);
  assert.deepStrictEqual([b.l, b.w, b.h], [600, 400, 500]);
  close(S.fillRatio('slope', v), 0.8);
});

console.log('\n箱型校验');

test('L形箱 W低+W高 ≠ W 必须报错并给出差值', () => {
  const errs = S.get('lshape').checks({ L: '600', W: '400', Wlow: '160', Whigh: '200', Hlow: '300', Hhigh: '500' });
  assert.ok(errs.length >= 1);
  const msg = errs.map((e) => e.message).join(' | ');
  assert.ok(msg.includes('360'), '应算出 360，实际：' + msg);
  assert.ok(msg.includes('差 40'), '应算出差 40，实际：' + msg);
});

test('L形箱 W低+W高 = W 时不报错', () => {
  const errs = S.get('lshape').checks({ L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' });
  assert.deepStrictEqual(errs, []);
});

test('L形箱允许 0.5mm 以内的小数舍入差', () => {
  const errs = S.get('lshape').checks({ L: '600', W: '400', Wlow: '160.2', Whigh: '239.8', Hlow: '300', Hhigh: '500' });
  assert.deepStrictEqual(errs, []);
  const errs2 = S.get('lshape').checks({ L: '600', W: '400', Wlow: '160', Whigh: '239', Hlow: '300', Hhigh: '500' });
  assert.ok(errs2.length >= 1, '差 1mm 应报错');
});

test('L形箱 H低 ≥ H高 必须报错', () => {
  const errs = S.get('lshape').checks({ L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '500', Hhigh: '500' });
  assert.ok(errs.some((e) => e.field === 'Hlow' && e.message.includes('小于')));
});

test('斜顶箱 H底 ≥ H高 必须报错', () => {
  const errs = S.get('slope').checks({ L: '600', W: '400', Hlow: '500', Hhigh: '500' });
  assert.ok(errs.some((e) => e.field === 'Hlow' && e.message.includes('必须小于')));
});

test('非正数 / 空值必须报错', () => {
  const errs = S.get('rect').checks({ L: '0', W: '', H: '-5' });
  assert.strictEqual(errs.length, 3);
});

console.log('\n集装箱约束');

const c40hq = C.get('40HQ');

test('40HQ 门高 2585：2600mm 高箱必须报“门高”错误，而不是笼统说内高不够', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '1000', W: '1000', H: '2600' }, qty: '1', weight: '10' };
  const errs = V.rowErrors(row, c40hq);
  const msg = errs.filter((e) => e.level === 'error').map((e) => e.message).join(' | ');
  assert.ok(msg.includes('门高 2585'), '实际：' + msg);
  assert.ok(!msg.includes('超过 40HQ 内高'), '不应误报内高，实际：' + msg);
});

test('40HQ 内高 2698：2700mm 高箱报内高错误', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '1000', W: '1000', H: '2700' }, qty: '1', weight: '10' };
  const msg = V.rowErrors(row, c40hq).map((e) => e.message).join(' | ');
  assert.ok(msg.includes('内高 2698'), '实际：' + msg);
});

test('40HQ：底面最短边超过内宽 2352 报错', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '3000', W: '2400', H: '500' }, qty: '1', weight: '10' };
  const msg = V.rowErrors(row, c40hq).filter((e) => e.level === 'error').map((e) => e.message).join(' | ');
  assert.ok(msg.includes('内宽 2352'), '实际：' + msg);
});

test('40HQ：400×300×300 合法，无 error', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '400', W: '300', H: '300' }, qty: '100', weight: '12' };
  const errs = V.rowErrors(row, c40hq).filter((e) => e.level === 'error');
  assert.deepStrictEqual(errs, []);
});

console.log('\n整单汇总');

test('100 箱 400×300×300：净体积 3.600 m³、外接 3.600 m³、总重 1200 kg', () => {
  const state = {
    container: C.get('40HQ'),
    rows: [{ id: 'a', shape: 'rect', name: 'A', values: { L: '400', W: '300', H: '300' }, qty: '100', weight: '12' }]
  };
  const res = V.all(state);
  assert.strictEqual(res.ok, true, JSON.stringify(res.rowErrors));
  close(res.totals.netVolume, 3.6e9);
  close(res.totals.outerVolume, 3.6e9);
  close(res.totals.weight, 1200);
  assert.strictEqual(res.totals.qty, 100);
});

test('没填单箱重量：给出 warn 但不阻断计算', () => {
  const state = {
    container: C.get('40HQ'),
    rows: [{ id: 'a', shape: 'rect', name: '', values: { L: '400', W: '300', H: '300' }, qty: '10', weight: '' }]
  };
  const res = V.all(state);
  assert.strictEqual(res.ok, true);
  assert.ok(res.warnCount >= 1);
  assert.strictEqual(res.totals.hasAllWeight, false);
});

test('数量必须为正整数', () => {
  const row = { id: 'a', shape: 'rect', values: { L: '400', W: '300', H: '300' }, qty: '2.5', weight: '1' };
  const msg = V.rowErrors(row, c40hq).map((e) => e.message).join(' | ');
  assert.ok(msg.includes('整数'), '实际：' + msg);
});

test('空清单算不通过', () => {
  const res = V.all({ container: C.get('40HQ'), rows: [] });
  assert.strictEqual(res.ok, false);
});

console.log('\n' + passed + ' 通过，' + failures.length + ' 失败\n');
if (failures.length) process.exit(1);
