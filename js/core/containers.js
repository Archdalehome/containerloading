/*
 * 集装箱内置规格（单位 mm / kg）。
 * 参数来自项目定义，允许用户在界面上改；「恢复默认值」回到这里。
 *
 * 注意门高：40HQ 内高 2698 但门高只有 2585，超过门高的箱子装不进去。
 * 这是最常见的算柜错误之一，校验里必须拦。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});

  var PRESETS = [
    { key: '20GP', label: '20GP', innerL: 5898,  innerW: 2352, innerH: 2393, doorH: 2280, payload: 28200 },
    { key: '40GP', label: '40GP', innerL: 12032, innerW: 2352, innerH: 2393, doorH: 2280, payload: 26700 },
    { key: '40HQ', label: '40HQ', innerL: 12032, innerW: 2352, innerH: 2698, doorH: 2585, payload: 26500 },
    { key: '45HQ', label: '45HQ', innerL: 13556, innerW: 2352, innerH: 2698, doorH: 2585, payload: 27600 }
  ];

  function clone(c) {
    return {
      key: c.key,
      label: c.label,
      innerL: c.innerL,
      innerW: c.innerW,
      innerH: c.innerH,
      doorH: c.doorH,
      payload: c.payload
    };
  }

  function preset(key) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].key === key) return PRESETS[i];
    }
    return PRESETS[2]; // 40HQ 作默认
  }

  function isCustom(c) {
    var p = preset(c.key || '40HQ');
    return c.innerL !== p.innerL || c.innerW !== p.innerW || c.innerH !== p.innerH ||
      c.doorH !== p.doorH || c.payload !== p.payload;
  }

  NS.containers = {
    presets: PRESETS,
    get: function (key) { return clone(preset(key)); },
    isCustom: isCustom,
    defaultKey: '40HQ'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.containers;
})(typeof globalThis !== 'undefined' ? globalThis : this);
