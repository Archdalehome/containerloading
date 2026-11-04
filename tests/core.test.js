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

test('L形箱总深 W 自动等于 W低+W高（传错也不报错，按自动值算）', () => {
  const errs = S.get('lshape').checks({ L: '600', W: '999', Wlow: '160', Whigh: '200', Hlow: '300', Hhigh: '500' });
  assert.deepStrictEqual(errs, [], '总深是自动算的，不该再报"总深不一致"');
  const bb = S.get('lshape').bbox({ L: '600', W: '999', Wlow: '160', Whigh: '200', Hhigh: '500' });
  assert.strictEqual(bb.w, 360, '外接深度应按 160+200=360，实际 ' + bb.w);
});

test('L形箱总深由 derive 补出来', () => {
  const v = S.derive('lshape', { Wlow: '160.5', Whigh: '239.5' });
  assert.strictEqual(v.W, '400');
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

test('默认不限方向：2600mm 高的箱子能躺下装，只提示换方向', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '1000', W: '1000', H: '2600' }, qty: '1', weight: '10' };
  const errs = V.rowErrors(row, c40hq);
  const errors = errs.filter((e) => e.level === 'error').map((e) => e.message).join(' | ');
  const warns = errs.filter((e) => e.level === 'warn').map((e) => e.message).join(' | ');
  assert.strictEqual(errors, '', '2600 高躺下能进，不该报错：' + errors);
  assert.ok(warns.includes('占用'), '应提示换方向后的占用高度，实际：' + warns);
});

test('任何朝向都放不进才报门高：2700×2700×2700', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '2700', W: '2700', H: '2700' }, qty: '1', weight: '10' };
  const msg = V.rowErrors(row, c40hq).filter((e) => e.level === 'error').map((e) => e.message).join(' | ');
  assert.ok(msg.includes('门高 2585'), '实际：' + msg);
});

test('2700mm 高但底面放得下的箱子，允许躺下装（1000 高）', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '2700', W: '1000', H: '1000' }, qty: '1', weight: '10' };
  const errors = V.rowErrors(row, c40hq).filter((e) => e.level === 'error');
  assert.deepStrictEqual(errors, []);
});

test('两个方向都超过内宽才报错：3000×3000×500', () => {
  const row = { id: 'r1', shape: 'rect', values: { L: '3000', W: '3000', H: '500' }, qty: '1', weight: '10' };
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
