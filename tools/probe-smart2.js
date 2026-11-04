// 探针：照抄 index.html 的 doSmartPack 排序，看最终会选哪一份方案
// 用法：node tools/probe-smart2.js <qty> [shape]
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

const qty = Number(process.argv[2] || 30);
const rows = process.argv[3] === 'mix'
  ? [
      { id: 'r1', shape: 'lshape', name: 'L形箱', qty: String(qty), values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 }, allowFlip: true, allowSide: true },
      { id: 'r2', shape: 'rect', name: '小箱', qty: '100', values: { L: 600, W: 400, H: 400 }, allowFlip: true, allowSide: true }
    ]
  : [{
      id: 'r1', shape: 'lshape', name: 'L形箱', qty: String(qty),
      values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 },
      allowFlip: true, allowSide: true
    }];

const t0 = Date.now();
const nOf = (pk) => (pk && pk.totals && pk.totals.loadedCount) || 0;
const envelope = (pk) => {
  let mx = 0, my = 0, mz = 0;
  for (const p of (pk && pk.placements) || []) { mx = Math.max(mx, p.x + p.l); my = Math.max(my, p.y + p.w); mz = Math.max(mz, p.z + p.h); }
  return mx * my * mz;
};
const lenOf = (pk) => { let m = 0; for (const p of (pk && pk.placements) || []) m = Math.max(m, p.x + p.l); return m; };
const gapOf = (pk) => Math.abs((c.innerL ? lenOf(pk) / c.innerL : 0) - ((pk && pk.totals && pk.totals.fillRate) || 0));

const cands = [];
const addCand = (pk, tag) => {
  if (!pk) return;
  const errs = P.validatePhysics(pk);
  cands.push({ tag, boxes: nOf(pk), len: lenOf(pk), gap: gapOf(pk), env: envelope(pk), errs: errs.length, pack: pk });
};

addCand(P.runSlices({ container: c, rows, options: {} }), 'slices');
const oc = P.optimalColumns(rows, c);
if (oc && P.validatePhysics(oc).length === 0) addCand(oc, 'colDP');
const cm = P.runColumnMix(rows, c);
if (cm && P.validatePhysics(cm).length === 0) addCand(cm, 'mixDP');
const plans = P.runPlans({ container: c, rows, options: {} });
(plans.ranked || []).forEach((p, i) => { if (p.valid && !p.gated && p.pack) addCand(p.pack, 'plan#' + i); });
addCand(P.run({ container: c, rows, options: {} }), 'run');

cands.sort((a, b) => (b.boxes - a.boxes) || (a.gap - b.gap) || (a.len - b.len) || (a.env - b.env));
const finalists = cands.slice(0, 10);
finalists.forEach((x) => { x.viol = P.fillOrderViolations(x.pack, c); });
finalists.sort((a, b) => (b.boxes - a.boxes) || (a.viol - b.viol) || (a.gap - b.gap) || (a.len - b.len) || (a.env - b.env));
const ordered = finalists.concat(cands.slice(finalists.length));
console.log(qty + ' 只 · 用时 ' + (Date.now() - t0) + 'ms · 候选 ' + cands.length + ' 个');
ordered.slice(0, 5).forEach((x, i) => {
  console.log('  ' + (i + 1) + '. ' + x.tag.padEnd(9) + ' 箱数 ' + String(x.boxes).padStart(3) +
    ' 柜长 ' + (x.len / 1000).toFixed(2).padStart(5) + 'm 利用率 ' + (x.pack.totals.fillRate * 100).toFixed(1) + '%' +
    ' 差 ' + (x.gap * 100).toFixed(1) + 'pt 半排空 ' + (x.viol == null ? '—' : x.viol) + ' 物理错误 ' + x.errs);
});
