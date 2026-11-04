// 随机交叉验证（混装）：runColumnMix 必须
//   1) 物理校验 0 错误
//   2) 不越界（柜长 ≤ 柜内长）
//   3) 装得不少于主引擎 run()（否则它在排名里没有意义，直接记一条）
// 用法：node tools/crosscheck-mix.js [组数]
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function round(n) { return Math.round(n / 10) * 10; }

function makeRow(i) {
  const shape = pick(['rect', 'lshape', 'slope']);
  let values;
  if (shape === 'rect') {
    values = { L: round(rnd(300, 2400)), W: round(rnd(200, 1200)), H: round(rnd(150, 1400)) };
  } else if (shape === 'lshape') {
    const wl = round(rnd(200, 700)), wh = round(rnd(200, 700));
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 600));
    values = { L: round(rnd(400, 2400)), Wlow: wl, Whigh: wh, Hlow: hl, Hhigh: hh };
  } else {
    const hl = round(rnd(150, 700)), hh = round(hl + rnd(50, 700));
    values = { L: round(rnd(400, 2400)), W: round(rnd(200, 1200)), Hlow: hl, Hhigh: hh };
  }
  return { id: 'r' + i, shape, name: shape + i, qty: String(Math.round(rnd(1, 40))), values, allowFlip: true, allowSide: true };
}

const N = Number(process.argv[2] || 40);
let ok = 0, bad = 0, less = 0, overflow = 0;
const t0 = Date.now();

for (let t = 0; t < N; t++) {
  const c = C.get(pick(['20GP', '40GP', '40HQ']));
  const rows = [makeRow(0), makeRow(1)];
  const mix = P.runColumnMix(rows, c);
  if (!mix) { console.log('无解（跳过）'); continue; }
  const errs = P.validatePhysics(mix);
  let len = 0;
  mix.placements.forEach((p) => { len = Math.max(len, p.x + p.l); });
  const ref = P.run({ container: c, rows, options: {} });
  if (errs.length) {
    bad++;
    console.log('物理错误 ' + errs.length + ' 处：' + JSON.stringify(rows.map((r) => r.shape + JSON.stringify(r.values) + '×' + r.qty)) + ' :: ' + errs.slice(0, 2).map((e) => e.code + '@' + (e.placement && e.placement.kind)).join(','));
    continue;
  }
  if (len > c.innerL + 1) {
    overflow++;
    console.log('越界：柜长 ' + (len / 1000).toFixed(2) + 'm > ' + (c.innerL / 1000).toFixed(2) + 'm');
    continue;
  }
  ok++;
  if (mix.totals.loadedCount < ref.totals.loadedCount) {
    less++;
    console.log('装得比主引擎少：' + mix.totals.loadedCount + ' vs ' + ref.totals.loadedCount + ' :: ' + JSON.stringify(rows.map((r) => r.shape + JSON.stringify(r.values) + '×' + r.qty)));
  }
}

console.log('\n结果：通过 ' + ok + ' / 物理错误 ' + bad + ' / 越界 ' + overflow + ' / 少于主引擎 ' + less + ' / 用时 ' + (Date.now() - t0) + 'ms');
process.exit(bad || overflow ? 1 : 0);
