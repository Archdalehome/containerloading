// 探针：扫一遍 z，找出对扣零穿插的落点（结论写回测试，不靠猜）
const S = require('../js/core/solid.js');
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const FLIPDOWN = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const it = {
  l: { id: 'l', shape: 'lshape', shapeValues: { l: 900, w: 700, h: 600, wlow: 350, whigh: 350, hlow: 300, hhigh: 600 }, bbox: { l: 900, w: 700, h: 600 } },
  s: { id: 's', shape: 'slope', shapeValues: { l: 2000, w: 470, h: 900, hlow: 500, hhigh: 900 }, bbox: { l: 2000, w: 470, h: 900 } }
};
[
  ['L 对称 350/350', it.l, { x: 0, y: 0, z: 0, l: 900, w: 700, h: 600, pose: IDENT, skuId: 'l' }],
  ['L 不对称 250/450', { id: 'la', shape: 'lshape', shapeValues: { l: 900, w: 700, h: 600, wlow: 250, whigh: 450, hlow: 300, hhigh: 600 }, bbox: { l: 900, w: 700, h: 600 } }, { x: 0, y: 0, z: 0, l: 900, w: 700, h: 600, pose: IDENT, skuId: 'la' }],
  ['斜顶 500/900', it.s, { x: 0, y: 0, z: 0, l: 2000, w: 470, h: 900, pose: IDENT, skuId: 's' }]
].forEach(([name, item, lower]) => {
  const rows = [];
  for (let z = 0; z <= 900; z += 50) {
    const up = { skuId: lower.skuId, x: 0, y: 0, z, l: lower.l, w: lower.w, h: lower.h, pose: FLIPDOWN };
    rows.push(z + ':' + Math.round(S.overlapDepth(up, lower, item, item, 10)));
  }
  console.log(name + ' → ' + rows.join(' '));
});
