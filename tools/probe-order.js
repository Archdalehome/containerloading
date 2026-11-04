// 探针：检查「第一排横截面装满再推进」是否成立。
// 做法：沿柜长每 50mm 取一片，算这一片的横截面填充率（按外接体面积占比）。
// 现场规则要求这个剖面「从柜头到柜门单调不增」——前面没填满就出现的突增，
// 就是用户看到的「里面没装满就开始装第二排第三排」。
const P = require('../js/core/pack.js');
const C = require('../js/core/containers.js');

function profile(pack, c, step) {
  const s = step || 50;
  const n = Math.ceil(c.innerL / s);
  const fill = new Array(n).fill(0);
  const cross = c.innerW * c.innerH;
  (pack.placements || []).forEach((p) => {
    const i0 = Math.floor(p.x / s);
    const i1 = Math.min(n - 1, Math.ceil((p.x + p.l) / s) - 1);
    const area = p.w * p.h;
    for (let i = i0; i <= i1; i++) {
      // 按这段与箱子在柜长方向的重叠比例折算
      const seg0 = Math.max(p.x, i * s);
      const seg1 = Math.min(p.x + p.l, (i + 1) * s);
      if (seg1 <= seg0) continue;
      fill[i] += area * (seg1 - seg0) / p.l;
    }
  });
  return fill.map((a) => Math.min(1, a / cross));
}

function spark(vals) {
  const blocks = ' ▁▂▃▄▅▆▇█';
  return vals.map((v) => blocks[Math.min(8, Math.max(0, Math.round(v * 8)))]).join('');
}

function report(tag, pack, c) {
  if (!pack) { console.log(tag + '：无'); return; }
  const prof = profile(pack, c);
  let len = 0;
  pack.placements.forEach((p) => { len = Math.max(len, p.x + p.l); });
  const used = prof.slice(0, Math.ceil(len / 50));
  // 前半段里"填充率突然下降又回升"的位置
  const dips = [];
  for (let i = 1; i < used.length - 1; i++) {
    if (used[i] < used[i - 1] - 0.15 && used[i + 1] > used[i] + 0.15) dips.push(i);
  }
  console.log(tag + '  装 ' + pack.totals.loadedCount + ' 只 柜长 ' + (len / 1000).toFixed(2) + 'm');
  console.log('   ' + spark(used));
  console.log('   剖面格数 ' + used.length + '，突降又回升 ' + dips.length + ' 处' +
    (dips.length ? '（最近柜头的 x=' + (dips[0] * 50) + 'mm 附近）' : ''));
}

const big = (q) => ({ id: 'r1', shape: 'lshape', name: 'L形箱', qty: String(q), values: { L: 2300, Wlow: 500, Whigh: 440, Hlow: 450, Hhigh: 650 }, allowFlip: true, allowSide: true });
const small = { id: 'r2', shape: 'rect', name: '小箱', qty: '100', values: { L: 600, W: 400, H: 400 }, allowFlip: true, allowSide: true };

const c = C.get('40HQ');
console.log('=== 40HQ，单 SKU L 形 2300×940 ×30 ===');
report('列最优', P.optimalColumns([big(30)], c), c);
report('主引擎', P.run({ container: c, rows: [big(30)], options: {} }), c);
report('切片  ', P.runSlices({ container: c, rows: [big(30)], options: {} }), c);

console.log('\n=== 40HQ，混装 L ×20 + 小箱 ×100 ===');
const mixed = [big(20), small];
report('混装列块', P.runColumnMix(mixed, c), c);
report('主引擎  ', P.run({ container: c, rows: mixed, options: {} }), c);
report('切片    ', P.runSlices({ container: c, rows: mixed, options: {} }), c);
