// 一次性的自检脚本：抽页面里的模块脚本做语法检查，并列出引用的外部脚本
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.log('没找到模块脚本'); process.exit(1); }
const out = path.join(root, '.tmp-module.mjs');
fs.writeFileSync(out, m[1], 'utf8');
console.log('module 脚本 ' + m[1].length + ' 字符 → ' + out);

const srcs = [];
const re = /<script src="([^"]+)"/g;
let g;
while ((g = re.exec(html))) srcs.push(g[1]);
console.log('外部脚本 ' + srcs.length + ' 个：');
srcs.forEach((s) => {
  const p = path.join(root, s);
  console.log('  ' + (fs.existsSync(p) ? 'ok   ' : 'MISS ') + s);
});
const hasHandles = /id="handles"/.test(html);
const hasSync = /syncHandles\(\);/.test(html);
console.log('手柄容器 ' + (hasHandles ? 'ok' : 'MISSING') + ' / 每帧同步 ' + (hasSync ? 'ok' : 'MISSING'));
