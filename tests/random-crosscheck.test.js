/*
 * 随机尺寸对拍：验证「选哪个朝向」不再按尺寸打补丁。
 *
 * 参考解 = 层型背包（同一条输入、关掉条带填缝，两层求解空间一致）。
 * 断言引擎输出 ≥ 参考解（不能比可行解还差），并统计相等组数——相等即「该尺寸下引擎没有选错朝向」。
 *
 *   node tests/random-crosscheck.test.js [组数]
 */
'use strict';

const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const D = require('../js/core/layerdp.js');

const N = Number(process.argv[2] || 200);
let seed = 20261103;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function ri(a, b) {
  return a + Math.floor(rnd() * (b - a + 1));
}

function makeCase(i) {
  const kind = i % 4; // 0 矩形 / 1 L 对称 / 2 L 不对称 / 3 斜顶
  if (kind === 0) {
    return { shape: 'rect', values: { L: String(ri(200, 1200)), W: String(ri(200, 900)), H: String(ri(150, 900)) } };
  }
  if (kind === 3) {
    const l = ri(300, 1200);
    const w = ri(200, 900);
    const hLow = ri(150, 500);
    return { shape: 'slope', values: { L: String(l), W: String(w), Hlow: String(hLow), Hhigh: String(ri(hLow + 50, 1100)) } };
  }
  const w = ri(300, 1000);
  const l = ri(300, 1200);
  const hLow = ri(150, 500);
  const hHigh = ri(hLow + 50, 1100);
  if (kind === 1) {
    const half = Math.round(w / 2);
    return { shape: 'lshape', values: { L: String(l), W: String(w), Wlow: String(half), Whigh: String(w - half), Hlow: String(hLow), Hhigh: String(hHigh) } };
  }
  const wl = ri(100, w - 100);
  return { shape: 'lshape', values: { L: String(l), W: String(w), Wlow: String(wl), Whigh: String(w - wl), Hlow: String(hLow), Hhigh: String(hHigh) } };
}

let worse = 0;
let equal = 0;
const bad = [];

for (let i = 0; i < N; i++) {
  const cs = makeCase(i);
  const row = {
    id: 'a', shape: cs.shape, name: '', values: cs.values,
    qty: '500', weight: '', allowSide: true, allowFlip: true
  };
  const st = { container: C.get('40HQ'), rows: [row], options: { noStripFill: true } };
  const ps = P.runPlans(st);
  const pack = ps.best.pack;
  const ref = D.solve(pack.items, pack.container).boxes;
  const got = pack.totals.loadedCount;
  if (got < ref) {
    worse++;
    bad.push({ cs, got, ref });
  } else if (got === ref) {
    equal++;
  }
}

console.log('随机对拍 ' + N + ' 组（40HQ，关条带填缝，两层求解空间一致）');
console.log('  相等 ' + equal + ' 组 / 引擎更优 ' + (N - equal - worse) + ' 组 / 引擎更差 ' + worse + ' 组');

if (bad.length) {
  console.log('\n引擎比参考解还差的用例（必须修）：');
  bad.slice(0, 10).forEach((b) => {
    console.log('  ' + JSON.stringify(b.cs) + ' → 引擎 ' + b.got + ' 箱，参考 ' + b.ref + ' 箱');
  });
}
if (worse > 0) {
  console.log('\n失败：有尺寸下引擎选了更差的朝向/组合');
  process.exit(1);
}
console.log('\n全部 ≥ 参考解，无回归');
