/*
 * 装柜清单 CSV 自检：
 *   node tests/report.test.js
 */
'use strict';

const assert = require('assert');
const C = require('../js/core/containers.js');
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

function state(rows) {
  return { container: C.get('40HQ'), rows };
}

const rows = [
  { id: 'a', shape: 'rect', name: '外箱 A', values: { L: '400', W: '300', H: '300' }, qty: '500', weight: '12' },
  { id: 'b', shape: 'lshape', name: '异形 B', values: { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, qty: '30', weight: '9' },
  { id: 'c', shape: 'slope', name: '斜顶 C', values: { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, qty: '12', weight: '10' }
];

const st = state(rows);
const pack = P.run(st);
const now = new Date(2026, 10, 2, 15, 30);
const csv = R.buildCsv(pack, st, { now: now, extra: null });
const lines = csv.replace(/^\uFEFF/, '').split('\r\n');

console.log('\nCSV 结构');

test('UTF-8 BOM 开头（Excel 不乱码）', () => {
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
});

test('基本信息齐全', () => {
  assert.ok(csv.includes('集装箱规格,40HQ'));
  assert.ok(csv.includes('内尺寸(mm),12032 × 2352 × 2698'));
  assert.ok(csv.includes('门高(mm),2585'));
  assert.ok(csv.includes('已装箱数,' + pack.totals.loadedCount + ' / ' + pack.totals.requestedCount));
});

test('分层小计：行数等于层数，含层高与层顶', () => {
  const start = lines.findIndex((l) => l.startsWith('分层小计'));
  const header = lines[start + 1];
  assert.ok(header.includes('层号') && header.includes('层高(mm)') && header.includes('姿态'), header);
  const layerLines = [];
  for (let i = start + 2; i < lines.length; i++) {
    if (!lines[i]) break;
    layerLines.push(lines[i]);
  }
  assert.strictEqual(layerLines.length, pack.layers.length);
  assert.ok(layerLines[0].startsWith('1,'), layerLines[0]);
});

test('逐箱明细行数 = 已装箱数，列数一致', () => {
  const start = lines.findIndex((l) => l.startsWith('逐箱明细'));
  const detailHeader = lines[start + 1];
  const cols = detailHeader.split(',').length;
  assert.strictEqual(cols, 16, '明细列数 ' + cols);
  assert.ok(detailHeader.includes('层号') && detailHeader.includes('列号') && detailHeader.includes('排号') && detailHeader.includes('姿态'));
  let n = 0;
  for (let i = start + 2; i < lines.length; i++) {
    if (!lines[i]) continue;
    n++;
    assert.strictEqual(lines[i].split(',').length, 16, '第 ' + (i - start - 1) + ' 行列数不对：' + lines[i]);
  }
  assert.strictEqual(n, pack.totals.loadedCount, '明细行数 ' + n);
});

test('明细里姿态写明清放/倒放/侧放', () => {
  const start = lines.findIndex((l) => l.startsWith('逐箱明细'));
  const seen = new Set();
  for (let i = start + 2; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = lines[i].split(',')[6];
    seen.add(v);
    assert.ok(/正放|倒放|侧放|填缝/.test(v), '姿态异常：' + v);
  }
  assert.ok(seen.size >= 1, '没有任何姿态');
});

test('名字里有逗号时会被引号包住', () => {
  const s2 = state([{ id: 'x', shape: 'rect', name: 'A,B 箱', values: { L: '400', W: '300', H: '300' }, qty: '2', weight: '5' }]);
  const p2 = P.run(s2);
  const c2 = R.buildCsv(p2, s2, { now: now });
  assert.ok(c2.includes('"A,B 箱"'), '应为 "A,B 箱"');
});

test('文件名带柜型和日期', () => {
  assert.strictEqual(R.suggestName(pack, now), '装柜清单_40HQ_20261102_1530.csv');
});

test('补柜信息写进 CSV', () => {
  const s3 = state([{ id: 'a', shape: 'rect', name: 'A', values: { L: '400', W: '300', H: '300' }, qty: '3400', weight: '10' }]);
  const p3 = P.run(s3);
  const extra = P.extraContainers(s3, p3);
  const c3 = R.buildCsv(p3, s3, { now: now, extra: extra });
  assert.ok(c3.includes('所需柜数,3 个 40HQ'), c3.split('\r\n').slice(0, 15).join(' | '));
});

console.log('\n' + passed + ' 通过，' + failures.length + ' 失败\n');
if (failures.length) process.exit(1);
