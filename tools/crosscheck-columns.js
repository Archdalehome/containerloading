// 随机交叉验证：单 SKU 的「列最优」（含对扣块）必须
//   1) 物理校验 0 错误
//   2) 柜长不劣于主引擎 run()（装同样多的箱子）
// 不满足就打印那一组，方便复现。
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

const containers = ['20GP', '40GP', '40HQ'];
let worse = 0, bad = 0, better = 0, same = 0, ok = 0;
const N = Number(process.argv[2] || 150);

for (let t = 0; t < N; t++) {
  const c = C.get(pick(containers));
  const shape = pick(['rect', 'lshape', 'slope']);
  let values, name;
  if (shape === 'rect') {
    values = { L: Math.round(rnd(300, 2400)), W: Math.round(rnd(200, 1200)), H: Math.round(rnd(150, 1400)) };
  } else if (shape === 'lshape') {
    const wl = Math.round(rnd(200, 700)), wh = Math.round(rnd(200, 700));
    const hl = Math.round(rnd(150, 700)), hh = Math.round(rnd(hl + 50, hl + 600));
    values = { L: Math.round(rnd(400, 2400)), Wlow: wl, Whigh: wh, Hlow: hl, Hhigh: hh };
  } else {
    const hl = Math.round(rnd(150, 700)), hh = Math.round(rnd(hl + 50, hl + 700));
    values = { L: Math.round(rnd(400, 2400)), W: Math.round(rnd(200, 1200)), Hlow: hl, Hhigh: hh };
  }
  const qty = Math.round(rnd(1, 60));
  const rows = [{ id: 'r1', shape, name, qty: String(qty), values, allowFlip: true, allowSide: true }];

  let oc = null;
  try { oc = P.optimalColumns(rows, c); } catch (e) { console.log('抛错 ' + shape + ' ' + JSON.stringify(values) + ' q=' + qty + ' :: ' + e.message); bad++; continue; }
  if (!oc) continue;
  const errs = P.validatePhysics(oc);
  if (errs.length) {
    console.log('物理错误 ' + errs.length + ' 处：' + shape + ' ' + JSON.stringify(values) + ' q=' + qty + ' 柜长 ' + (oc.length / 1000).toFixed(2) + 'm ' + JSON.stringify(errs.slice(0, 2).map((e) => e.code + ':' + e.message)));
    bad++;
    continue;
  }
  ok++;
  const ref = P.run({ container: c, rows, options: {} });
  const refN = ref.totals.loadedCount;
  const ocN = oc.totals.loadedCount;
  const ocLen = oc.length;
  // 先比装得多少（多者优），装得一样多才比柜长
  if (ocLen > c.innerL + 1) { worse++; console.log('超出柜长：' + shape + ' ' + JSON.stringify(values) + ' q=' + qty + ' 柜长 ' + (ocLen / 1000).toFixed(2) + 'm > ' + (c.innerL / 1000).toFixed(2) + 'm'); continue; }
  if (ocN < refN) { worse++; console.log('装得更少：' + shape + ' ' + JSON.stringify(values) + ' q=' + qty + ' 列 ' + ocN + ' vs 主 ' + refN); continue; }
  if (ocN > refN) { better++; continue; }
  let refLen = 0;
  ref.placements.forEach((p) => { refLen = Math.max(refLen, p.x + p.l); });
  if (ocLen < refLen - 1) better++;
  else if (Math.abs(ocLen - refLen) <= 1) same++;
  else { worse++; console.log('柜长更差：' + shape + ' ' + JSON.stringify(values) + ' q=' + qty + ' 列最优 ' + (ocLen / 1000).toFixed(2) + ' vs 主引擎 ' + (refLen / 1000).toFixed(2) + 'm'); }
}

console.log('\n结果：通过 ' + ok + ' / 物理错误 ' + bad + ' / 柜长更短 ' + better + ' / 持平 ' + same + ' / 更差 ' + worse);
process.exit(bad || worse ? 1 : 0);
