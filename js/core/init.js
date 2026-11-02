/*
 * Node 端的模块装配入口：让自检脚本一次拿到全部纯逻辑模块。
 * （浏览器不用这个文件，index.html 直接按顺序加载三个 core 脚本。）
 */
'use strict';

const shapes = require('./shapes.js');
const containers = require('./containers.js');
const validate = require('./validate.js');

module.exports = { shapes, containers, validate };
