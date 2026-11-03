/*
 * 四条验收标准（Chief 2026-11 定），每次改动都要跑：
 *   1) 异常输入不能崩，且要给明确提示：0/负数/非数字、超大、超门高、单箱超载重、几何不自洽
 *   2) 性能：20 种 SKU × 5000 箱，枚举完成 ≤ 2 秒
 *   3) 导出：每个 SKU 的已装 / 剩余 / 原因齐全
 *   4) 可复现：同一输入跑两次，结果完全一致
 *
 *   node tests/acceptance.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
const V = require('../js/core/validate.js');
const P = require('../js/core/pack.js');
const R = require('../js/core/report.js');

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

function row(id, values, qty, weight, shape) {
  return { id, shape: shape || 'rect', name: '', values, qty: String(qty), weight: weight === undefined ? '' : String(weight) };
}
function st(rows, opts) {
  return { container: C.get('40HQ'), rows, options: Object.assign({ allowFill: false }, opts || {}) };
}
function messages(res) {
  const out = [];
  Object.keys(res.rowErrors || {}).forEach((k) => (res.rowErrors[k] || []).forEach((e) => out.push(e)));
  (res.containerErrors || []).forEach((e) => out.push(e));
  return out;
}

// ---------- 1. 异常输入 ----------
console.log('\n1) 异常输入：不能崩，且要有明确提示');

const badCases = [
  ['数量 0', [row('a', { L: '400', W: '300', H: '300' }, 0)], /数量/],
  ['数量 -5', [row('a', { L: '400', W: '300', H: '300' }, -5)], /数量/],
  ['数量非数字', [row('a', { L: '400', W: '300', H: '300' }, 'abc')], /数量/],
  ['尺寸 0', [row('a', { L: '0', W: '300', H: '300' }, 10)], /大于 0/],
  ['箱子比柜内长还长', [row('a', { L: '20000', W: '300', H: '300' }, 10)], /超过 40HQ 内长/],
  ['箱子比柜内高还高', [row('a', { L: '400', W: '300', H: '4000' }, 10)], /内高/],
  ['箱高过门高', [row('a', { L: '400', W: '300', H: '2600' }, 10)], /门高/],
  ['单箱超载重', [row('a', { L: '400', W: '300', H: '300' }, 10, 30000)], /载重上限/],
  ['重量为负', [row('a', { L: '400', W: '300', H: '300' }, 10, -3)], /单箱重量/],
  ['L 形 W低+W高≠W', [row('a', { L: '600', W: '400', Wlow: '100', Whigh: '100', Hlow: '300', Hhigh: '500' }, 10, '', 'lshape')], /W低 \+ W高/],
  ['斜顶 H底≥H高', [row('a', { L: '600', W: '400', Hlow: '500', Hhigh: '300' }, 10, '', 'slope')], /H低 必须小于 H高|H底 必须小于 H高/]
];

badCases.forEach(([name, rows, re]) => {
  test('拦下并提示：' + name, () => {
    let res;
    assert.doesNotThrow(() => { res = V.all(st(rows)); }, name + ' 抛异常了');
    assert.strictEqual(res.ok, false, name + ' 没有被拦下');
    const errs = messages(res).filter((e) => e.level === 'error');
    assert.ok(errs.length > 0, name + ' 没有 error 级提示');
    assert.ok(errs.some((e) => re.test(e.message)), name + ' 的提示不对：' + errs.map((e) => e.message).join(' | '));
  });
});

test('容器参数非法时也不崩', () => {
  const bad = { key: '坏柜', innerL: 0, innerW: 'x', innerH: -1, doorH: '', payload: 'abc' };
  let res;
  assert.doesNotThrow(() => { res = V.all({ container: bad, rows: [row('a', { L: '400', W: '300', H: '300' }, 1)] }); });
  assert.strictEqual(res.ok, false);
  assert.ok(messages(res).some((e) => e.level === 'error'));
});

test('几种 SKU 全部异常时一起报，不白屏', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(row('x' + i, { L: '0', W: '0', H: '0' }, 0));
  let res;
  assert.doesNotThrow(() => { res = V.all(st(rows)); });
  assert.strictEqual(res.ok, false);
  assert.ok(Object.keys(res.rowErrors).length === 12, '应逐行报错');
});

// ---------- 2. 性能 ----------
console.log('\n2) 性能：20 种 SKU × 5000 箱 ≤ 2 秒');

test('20 种 SKU × 5000 箱枚举 ≤ 2 秒', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const L = 300 + (i % 5) * 60;
    const W = 200 + (i % 4) * 50;
    const H = 200 + (i % 3) * 60;
    rows.push(row('s' + i, { L: String(L), W: String(W), H: String(H) }, 250, '8'));
  }
  const t0 = Date.now();
  const ps = P.runPlans(st(rows));
  const ms = Date.now() - t0;
  assert.ok(ms <= 2000, '耗时 ' + ms + ' ms 超过 2 秒');
  assert.ok(ps.best.boxes > 0, '没装进去任何箱子');
  console.log('      ' + ms + ' ms，' + ps.compared + ' 个方案，最优 ' + ps.best.boxes + ' 箱');
});

// ---------- 3. 导出齐全 ----------
console.log('\n3) 导出：每个 SKU 的已装 / 剩余 / 原因');

test('CSV 有「各箱型装载结果」且每行都有已装/剩余/原因', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 2000, '8'),
    row('b', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 300, '9', 'slope')
  ];
  const s = st(rows);
  const ps = P.runPlans(s);
  const pack = ps.best.pack;
  const csv = R.buildCsv(pack, s, { now: new Date(2026, 10, 3, 9, 0) });
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  const idx = lines.findIndex((l) => l.startsWith('各箱型装载结果'));
  assert.ok(idx >= 0, 'CSV 里没有「各箱型装载结果」小节');
  const header = lines[idx + 1];
  ['已装(箱)', '剩余(箱)', '未装原因'].forEach((k) => assert.ok(header.includes(k), '缺列 ' + k));
  const itemLines = [];
  for (let i = idx + 2; i < lines.length; i++) {
    if (!lines[i]) break;
    itemLines.push(lines[i]);
  }
  assert.strictEqual(itemLines.length, pack.items.length, 'SKU 行数不对');
  itemLines.forEach((l) => {
    const cols = l.split(',');
    assert.strictEqual(cols.length, 9, '列数不对：' + l);
    assert.ok(Number(cols[4]) === Number(cols[5]) + Number(cols[6]), '需求 ≠ 已装 + 剩余：' + l);
    assert.ok(cols[8] && cols[8].length > 0, '没有写原因：' + l);
  });
  assert.ok(csv.includes('剩余高度'), '没装完的 SKU 应写明原因');
});

test('全部装完时原因列写「全部装入」', () => {
  const rows = [row('a', { L: '400', W: '300', H: '300' }, 10, '8')];
  const s = st(rows);
  const pack = P.run(s);
  const csv = R.buildCsv(pack, s, { now: new Date(2026, 10, 3, 9, 0) });
  assert.ok(csv.includes('全部装入'), '全部装完时应写「全部装入」');
});

// ---------- 4. 可复现 ----------
console.log('\n4) 可复现：同一输入跑两次结果完全一致');

test('同一输入两次结果完全一致（逐箱位置也一样）', () => {
  const rows = [
    row('a', { L: '400', W: '300', H: '300' }, 800, '8'),
    row('b', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 300, '9', 'lshape'),
    row('c', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 300, '10', 'slope')
  ];
  const sig = (p) => JSON.stringify({ t: p.totals, l: p.layers, p: p.placements });
  const a = P.runPlans(st(rows));
  const b = P.runPlans(st(rows));
  assert.strictEqual(sig(a.best.pack), sig(b.best.pack), '两次结果不一致');
  assert.ok(a.best.boxes > 0);
});

test('底面超尺寸的箱子：拦下并说明，引擎也不会假装装得进去', () => {
  // 6000×3000×3000：任何姿态都至少有两个面超过柜内宽 2352，转都转不进去
  const rows = [row('big', { L: '6000', W: '3000', H: '3000' }, 2, '30')];
  const res = V.all(st(rows));
  assert.strictEqual(res.ok, false, '超宽箱应被校验拦下');
  const errs = messages(res).filter((e) => e.level === 'error');
  assert.ok(errs.some((e) => /内宽|内长/.test(e.message)), '提示没说清是底面超尺寸：' + errs.map((e) => e.message).join(' | '));

  // 引擎侧：本柜 0 箱，补柜也装不进（impossibleCount > 0 → 界面上会有「换同规格柜也装不进」那一行）
  const pack = P.run(st(rows));
  assert.strictEqual(pack.totals.loadedCount, 0, '超宽箱不该被装进去');
  const extra = P.extraContainers(st(rows), pack);
  assert.strictEqual(extra.count, 0, '超宽箱不该算出要开新柜');
  assert.ok(extra.impossibleCount > 0, '应把超宽箱算进「换柜也装不进」');
});

test('不传姿态标志 == 显式全开（默认值只有一处，不能静默少算）', () => {
  const mk = (extra) => Object.assign({
    id: 'a', shape: 'rect', name: '',
    values: { L: '400', W: '300', H: '300' }, qty: '5000', weight: '8'
  }, extra || {});
  [['40HQ', 1820], ['40GP', 1610]].forEach(([key, want]) => {
    const implicit = P.runPlans({ container: C.get(key), rows: [mk()], options: {} });
    const explicit = P.runPlans({ container: C.get(key), rows: [mk({ allowSide: true, allowFlip: true })], options: {} });
    assert.strictEqual(implicit.best.boxes, explicit.best.boxes,
      key + ' 不传标志 ' + implicit.best.boxes + ' ≠ 显式全开 ' + explicit.best.boxes);
    assert.strictEqual(implicit.best.boxes, want, key + ' 默认应为 ' + want + ' 箱，实际 ' + implicit.best.boxes);
  });
  // 显式关掉仍然生效
  const off = P.runPlans({ container: C.get('40HQ'), rows: [mk({ allowSide: false, allowFlip: true })], options: {} });
  assert.ok(off.best.boxes < 1820, '显式关侧放后应少于 1820，实际 ' + off.best.boxes);
});

console.log('\n' + passed + ' 通过，' + failures.length + ' 失败\n');
if (failures.length) process.exit(1);
