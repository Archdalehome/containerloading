// 复核：600×400 斜顶（H底 300 / H高 500）两只对扣，为什么可能失败
const L = require('../js/core/corner-link.js');
const S = require('../js/core/solid.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');

const it = {
  id: 's', shape: 'slope',
  shapeValues: { l: 600, w: 400, h: 500, hlow: 300, hhigh: 500 },
  bbox: { l: 600, w: 400, h: 500 }
};
const items = { s: it };
const lower = { skuId: 's', x: 0, y: 0, z: 0, l: 600, w: 400, h: 500, uid: 'S1' };

[[0, 0], [40, 30], [300, 0], [0, 300], [600, 0], [700, 500]].forEach(([x, y]) => {
  const drop = { skuId: 's', x, y, z: 0, l: 600, w: 400, h: 500, uid: 'S2' };
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  if (!r.ok) { console.log('drop@(' + x + ',' + y + ') → 不扣：' + r.reason); return; }
  const depth = S.overlapDepth(r.box, lower, it, it, 10);
  console.log('drop@(' + x + ',' + y + ') → 扣上 z=' + r.box.z + ' 穿插 ' + depth.toFixed(1) + 'mm');
});
