// 读 Edge --dump-dom 的结果，看页面有没有脚本错误、手柄容器在不在
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(process.env.TEMP, 'cl-dom.html');
if (!fs.existsSync(file)) { console.log('没有 dump 文件：' + file); process.exit(1); }
const s = fs.readFileSync(file, 'utf8');
const errs = [];
const re = /脚本错误[^<]*/g;
let m;
while ((m = re.exec(s))) errs.push(m[0]);
const st = s.match(/id="status"[^>]*>([^<]*)/);
const s2 = s.match(/id="stat2"[^>]*>([^<]*)/);
console.log('dump 大小 ' + s.length + ' 字节');
console.log('脚本错误 ' + errs.length + ' 条' + (errs.length ? '\n  ' + errs.join('\n  ') : ''));
console.log('#status  ' + (st ? st[1].trim() : '(没找到)'));
console.log('#stat2   ' + (s2 ? s2[1].trim() : '(没找到)'));
console.log('手柄容器 ' + (/id="handles"/.test(s) ? '在' : '不在'));
console.log('画布 ' + (/<canvas/.test(s) ? '已创建' : '没创建'));
