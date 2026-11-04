// 生成旧的 manual-proto.html 跳转页（首页已经换成手动装柜）
const fs = require('fs');
const path = require('path');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=./">
<title>装柜计算 · 转到首页</title>
<style>
  body { margin: 0; background: #0f172a; color: #e2e8f0; font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  a { color: #38bdf8; }
</style>
</head>
<body>
<div>手动装柜已经是首页，正在跳转…<br><a href="./">没跳过去点这里</a></div>
<script>location.replace('./');</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'manual-proto.html'), html, 'utf8');
console.log('已生成 manual-proto.html 跳转页');
