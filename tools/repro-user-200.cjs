'use strict';
/* 反推用户那单：每层 30 箱、用高 900、净 0.616 m³/箱、5 kg/箱、200 箱、40GP */
const C = require('../js/core/containers.js');
const P = require('../js/core/pack.js');
const E = require('../js/core/explain.js');

function mkRow(shape, values, qty) {
  return { id: 'a', shape, name: '', values, qty: String(qty), weight: '5', allowSide: true, allowFlip: true };
}
function run(label, shape, values, qty) {
  const st = { container: C.get('40GP'), rows: [mkRow(shape, values, qty)], options: { allowDunnage: true, allowFill: false } };
  const ps = P.runPlans(st);
  const pack = ps.best.pack;
  pack.planSet = ps;
  const net = pack.items[0].netVolumeEach / 1e6;
  const perLayer = pack.layers[0] ? pack.layers[0].count : 0;
  console.log(label);
  console.log('  单箱净体积 ' + net.toFixed(3) + ' m³（用户 0.616）');
  console.log('  装 ' + pack.totals.loadedCount + ' 箱，' + pack.layers.length + ' 层，每层 ' + perLayer +
    ' 箱，用高 ' + pack.usedHeight + '，装载率 ' + (pack.totals.fillRate * 100).toFixed(1) + '%' +
    '，所需柜数 ' + (1 + P.extraContainers(st, pack).count));
  if (pack.layers.length) console.log('  层姿态：' + pack.layers.map((l) => l.kind + ':' + l.count + ':' + l.height).join(' | '));
  console.log('  为什么停：' + E.stopText(pack).base);
}

// 反推出来的尺寸：2000×470（6×5=30/层），高 900，净 0.616 m³
run('A. 矩形 2000×470×900（对照：如果矩形也只 1 层就是 bug）', 'rect', { L: '2000', W: '470', H: '900' }, 200);
run('B. 对称台阶 L 2000×470（235/235，H低325/H高900）', 'lshape', { L: '2000', W: '470', Wlow: '235', Whigh: '235', Hlow: '325', Hhigh: '900' }, 200);
run('C. 不对称台阶 L 2000×470（200/270，H低325/H高900）', 'lshape', { L: '2000', W: '470', Wlow: '200', Whigh: '270', Hlow: '325', Hhigh: '900' }, 200);
