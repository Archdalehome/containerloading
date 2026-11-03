// 复核：台阶 360/240 这种不对称 L 形，自动对扣会不会偷偷穿插
const S = require('../js/core/solid.js');
const L = require('../js/core/corner-link.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');
const combos = [[300, 600], [360, 600], [400, 720], [240, 480]];
combos.forEach(([hl, hh]) => {
  const it = {
    id: 'l', shape: 'lshape',
    shapeValues: { l: 600, w: 600, h: hh, wlow: 360, whigh: 240, hlow: hl, hhigh: hh },
    bbox: { l: 600, w: 600, h: hh }
  };
  const items = { l: it };
  const lower = { skuId: 'l', x: 0, y: 0, z: 0, l: 600, w: 600, h: hh, uid: 'L1' };
  const drop = { skuId: 'l', x: 40, y: 40, z: 0, l: 600, w: 600, h: hh, uid: 'L2' };
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  if (!r.ok) { console.log('H低' + hl + '/H高' + hh + ' → 不扣（' + r.reason + '）'); return; }
  const depth = S.overlapDepth(r.box, lower, it, it, 10);
  console.log('H低' + hl + '/H高' + hh + ' → 扣了，落点 z=' + r.box.z + '，实测穿插 ' + depth.toFixed(1) + 'mm');
});
