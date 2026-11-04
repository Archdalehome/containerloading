// 探针：对扣列 DP 的物理校验到底报什么错（L 形 2300×940，各数量）
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

const W = C.get ? C.get('40HQ') : C.list['40HQ'];
const box = (q) => [{
  id: 'r1', shape: 'lshape', name: 'L形箱', qty: String(q),
  values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 },
  allowFlip: true, allowSide: true
}];

[3, 5, 10, 15, 20, 30, 40].forEach((q) => {
  const pack = P.optimalColumns(box(q), W);
  if (!pack) { console.log(q + ' 只：无解'); return; }
  const errs = P.validatePhysics(pack);
  const byCode = {};
  errs.forEach((e) => { byCode[e.code] = (byCode[e.code] || 0) + 1; });
  console.log(q + ' 只：柜长 ' + (pack.length / 1000).toFixed(2) + 'm，装 ' + pack.placements.length +
    ' 只，错误 ' + errs.length + (errs.length ? ' ' + JSON.stringify(byCode) : ''));
  errs.slice(0, 3).forEach((e) => {
    const p = e.placement;
    console.log('    ' + e.code + ' @ x=' + p.x + ' y=' + p.y + ' z=' + p.z + ' l=' + p.l + ' w=' + p.w +
      ' h=' + p.h + ' kind=' + p.kind + ' pose=' + JSON.stringify(p.pose) + ' :: ' + e.message);
  });
});
