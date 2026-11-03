/* 临时探针：DFS 版层型求解（用户这单、六组基线） */
'use strict';
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const D = require('../js/core/layerdp.js');

function itemsFor(rows, c) {
  const pk = P.run({ container: c, rows: rows, options: { allowFill: false, sortBy: 'volume' } });
  return pk.items.map((it) => Object.assign({}, it, { remaining: it.qty, loaded: 0 }));
}

function show(name, rows, key) {
  const c = C.get(key);
  const items = itemsFor(rows, c);
  const t0 = Date.now();
  const r = D.solve(items, c);
  const ms = Date.now() - t0;
  console.log('== ' + name + '（' + key + '）→ ' + r.boxes + ' 箱 / 用高 ' + r.height + ' / ' + ms + 'ms / 节点 ' + r.nodes);
  r.layers.forEach((t, i) => {
    console.log('   层' + (i + 1), t.skuId, t.kind, '层厚' + t.thickness, '每层' + t.boxes + '箱', 'cover ' + t.cover.l + '×' + t.cover.w, t.stackable ? '可叠' : '顶层');
  });
  return r;
}

show('用户这单', [
  { id: 'a', shape: 'lshape', name: '', values: { L: '770', W: '700', Wlow: '350', Whigh: '350', Hlow: '450', Hhigh: '800' }, qty: '130', weight: '', allowSide: true, allowFlip: true },
  { id: 'b', shape: 'slope', name: '', values: { L: '700', W: '700', Hlow: '300', Hhigh: '600' }, qty: '190', weight: '', allowSide: true, allowFlip: true }
], '40HQ');

show('400×300×300', [{ id: 'a', shape: 'rect', name: '', values: { L: '400', W: '300', H: '300' }, qty: '5000', weight: '', allowSide: true, allowFlip: true }], '40HQ');
show('400×300×300', [{ id: 'a', shape: 'rect', name: '', values: { L: '400', W: '300', H: '300' }, qty: '5000', weight: '', allowSide: true, allowFlip: true }], '40GP');
show('斜顶 2000×470', [{ id: 'a', shape: 'slope', name: '', values: { L: '2000', W: '470', Hlow: '410', Hhigh: '900' }, qty: '200', weight: '', allowSide: true, allowFlip: true }], '40GP');
show('550×450×300', [{ id: 'a', shape: 'rect', name: '', values: { L: '550', W: '450', H: '300' }, qty: '5000', weight: '', allowSide: true, allowFlip: true }], '40HQ');
