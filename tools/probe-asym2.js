// 复核 2：自动对扣之后，上件到底有没有真的坐在下件上（面接触），还是悬在缝上
const L = require('../js/core/corner-link.js');
const C = require('../js/core/containers.js');
const c = C.get('40HQ');
const cases = [
  ['对称 300/300 H低300', { l: 600, w: 600, h: 600, wlow: 300, whigh: 300, hlow: 300, hhigh: 600 }],
  ['不对称 360/240 H低300', { l: 600, w: 600, h: 600, wlow: 360, whigh: 240, hlow: 300, hhigh: 600 }],
  ['不对称 240/360 H低300', { l: 600, w: 600, h: 600, wlow: 240, whigh: 360, hlow: 300, hhigh: 600 }],
  ['不对称 250/450 H低300', { l: 600, w: 600, h: 600, wlow: 250, whigh: 450, hlow: 300, hhigh: 600 }]
];
cases.forEach(([name, sv]) => {
  const it = { id: 'l', shape: 'lshape', shapeValues: Object.assign({}, sv), bbox: { l: sv.l, w: sv.w, h: sv.h } };
  const items = { l: it };
  const lower = { skuId: 'l', x: 0, y: 0, z: 0, l: sv.l, w: sv.w, h: sv.h, uid: 'L1' };
  const drop = { skuId: 'l', x: 40, y: 40, z: 0, l: sv.l, w: sv.w, h: sv.h, uid: 'L2' };
  const r = L.autoPairOnDrop(drop, [lower], c, items, { tol: 400 });
  if (!r.ok) { console.log(name + ' → 不扣（' + r.reason + '）'); return; }
  const ct = L.contactAt(r.box, [lower], items);
  const foot = r.box.l * r.box.w;
  console.log(name + ' → z=' + r.box.z + '，接触 ' + Math.round(ct.area) + '/' + Math.round(foot) +
    ' (' + Math.round(ct.area / foot * 100) + '%)');
});
