/*
 * v1 / v2 默认 / v2 允许 三列对照（同一输入各跑一遍）。
 * 用法：node tools/compare.cjs
 * v1 引擎直接从 git 历史里取（4a8b2de 是 v2 改造前的最后一版），保证对照的是真实旧代码。
 */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
require(path.join(root, 'js/core/shapes.js'));
const C = require(path.join(root, 'js/core/containers.js'));
const P2 = require(path.join(root, 'js/core/pack.js'));

const V1_COMMIT = '4a8b2de';
let P1;
try {
  let v1Path = process.argv[2];
  if (!v1Path) {
    const src = execSync('git show ' + V1_COMMIT + ':js/core/pack.js', { cwd: root }).toString();
    v1Path = path.join(os.tmpdir(), 'cl-pack-v1-' + Date.now() + '.js');
    fs.writeFileSync(v1Path, src);
  }
  P1 = require(v1Path);
} catch (e) {
  console.error('取 v1 引擎失败（可用 git show ' + V1_COMMIT + ':js/core/pack.js 导出后作为参数传入）：' + e.message);
  process.exit(1);
}

const c40hq = C.get('40HQ');

function row(id, shape, values, qty, weight) {
  return { id, shape, name: id.toUpperCase(), values, qty: String(qty), weight: weight === undefined ? '' : String(weight) };
}

const scenarios = [
  {
    name: '矩形 400×300×300 ×5000（基准）',
    rows: [row('a', 'rect', { L: '400', W: '300', H: '300' }, 5000)]
  },
  {
    name: '斜顶 600×400 300/500 ×1000',
    rows: [row('a', 'slope', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 1000)]
  },
  {
    name: '斜顶 600×400 200/500 ×1000',
    rows: [row('a', 'slope', { L: '600', W: '400', Hlow: '200', Hhigh: '500' }, 1000)]
  },
  {
    name: 'L形 600×400 160/240 300/500 ×1000',
    rows: [row('a', 'lshape', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 1000)]
  },
  {
    name: '细高 100×100×2000 ×5000',
    rows: [row('a', 'rect', { L: '100', W: '100', H: '2000' }, 5000)]
  },
  {
    name: '混装：矩形 300 + 斜顶 300 + L 200',
    rows: [
      row('a', 'rect', { L: '400', W: '300', H: '300' }, 300),
      row('b', 'slope', { L: '600', W: '400', Hlow: '300', Hhigh: '500' }, 300),
      row('c', 'lshape', { L: '600', W: '400', Wlow: '160', Whigh: '240', Hlow: '300', Hhigh: '500' }, 200)
    ]
  },
  {
    name: '填缝：矩形 1680 + 小箱 200×200×300 ×300',
    rows: [
      row('a', 'rect', { L: '400', W: '300', H: '300' }, 1680),
      row('b', 'rect', { L: '200', W: '200', H: '300' }, 300)
    ]
  }
];

function fmt(r) {
  const t = r.totals;
  return {
    boxes: t.loadedCount,
    net: t.netVolume / 1e9,
    rate: t.fillRate
  };
}

function cell(x) {
  return x.boxes + ' 箱 / ' + x.net.toFixed(2) + ' m³ / ' + (x.rate * 100).toFixed(1) + '%';
}

const lines = [];
lines.push('| 场景 | v1 | v2 默认（开关关） | v2 允许（倒放/侧放/填缝） |');
lines.push('|---|---|---|---|');

scenarios.forEach((s) => {
  const v1 = fmt(P1.run({ container: c40hq, rows: s.rows.map((r) => Object.assign({}, r)) }));
  const v2off = fmt(P2.run({ container: c40hq, rows: s.rows.map((r) => Object.assign({}, r)), options: { allowFill: false } }));
  const rowsOn = s.rows.map((r) => Object.assign({}, r, { allowFlip: true, allowSide: true }));
  const v2on = fmt(P2.run({ container: c40hq, rows: rowsOn, options: { allowFill: true } }));
  lines.push('| ' + s.name + ' | ' + cell(v1) + ' | ' + cell(v2off) + ' | ' + cell(v2on) + ' |');
});

console.log(lines.join('\n'));
console.log('\n口径：装载率 = 已装箱净体积 ÷ 40HQ 容积 76.35 m³。箱数才是硬指标。');
