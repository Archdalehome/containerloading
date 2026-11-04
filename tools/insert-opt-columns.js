// 装箱最优列（完全背包）——单 SKU 最短柜长
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'js', 'core', 'pack.js');
let s = fs.readFileSync(file, 'utf8');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'opt-columns-src.js'), 'utf8');
const anchor = '  /**\n   * 让布局从"最里面（柜头）"开始长，而不是从柜门开始。';
if (!s.includes(anchor)) { console.log('锚点没找到'); process.exit(1); }
s = s.replace(anchor, src + anchor);
fs.writeFileSync(file, s, 'utf8');
console.log('已插入 optimalColumns');
