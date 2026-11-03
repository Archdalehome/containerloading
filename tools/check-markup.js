// 结构自检：logo、build 标记、div 配平
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'manual-proto.html'), 'utf8');
const count = (re) => (s.match(re) || []).length;
console.log('logo 引用        ' + (s.includes('assets/logo.png') ? '有' : '没有'));
console.log('build 标记       ' + count(/id="build"/g) + ' 个');
console.log('stat2 已隐藏     ' + /id="stat2" style="display:none"/.test(s));
console.log('div 开/闭        ' + count(/<div\b/g) + ' / ' + count(/<\/div>/g));
console.log('说明性长句残留   ' + (s.includes('落点 150mm 内') || s.includes('松手会沉降') || s.includes('（键：1/2/3') ? '有' : '无'));
