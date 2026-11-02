/* 调试用：打印 browser-check.mjs 里第二个注入脚本（混装场景）的行号 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'browser-check.mjs'), 'utf8');
const marker = 'const mixed = await cdp.evaluate(`';
const start = src.indexOf(marker);
const end = src.indexOf('})()`)', start);
if (start < 0 || end < 0) {
  console.error('找不到混装脚本');
  process.exit(1);
}
const body = src.slice(start + marker.length, end + 3);
const lines = body.split('\n');
const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || lines.length);
for (let i = from - 1; i < to && i < lines.length; i++) {
  console.log(String(i + 1).padStart(3) + ': ' + lines[i]);
}
