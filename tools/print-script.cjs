/* 调试用：把 browser-check.mjs 里注入页面的脚本按行号打印出来 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'browser-check.mjs');
const src = fs.readFileSync(file, 'utf8');
const marker = 'return `(async () => {';
const start = src.indexOf(marker);
const end = src.indexOf('})()`;', start);
if (start < 0 || end < 0) {
  console.error('找不到注入脚本');
  process.exit(1);
}
const body = src.slice(start + 'return `'.length, end + 3);
const lines = body.split('\n');
const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || lines.length);
for (let i = from - 1; i < to && i < lines.length; i++) {
  console.log(String(i + 1).padStart(3) + ': ' + lines[i]);
}
