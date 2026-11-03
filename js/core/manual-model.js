/*
 * 手动装柜的数据模型：箱子列表、撤销栈、复制、计数。
 * 3D 层只管画和拖，状态一律以这里为准（底部计数也从这里取，不从渲染对象取）。
 *
 * 约定（Chief 定）：
 *   - 状态只在**成功**时提交，被拒绝的落位不写进模型
 *   - 撤销按「一次操作」入栈（放置 / 移动 / 旋转 / 复制 / 删除），不按帧
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});
  if (!NS.manual && typeof require === 'function') NS.manual = require('./manual.js');
  var M = NS.manual;

  var UNDO_LIMIT = 20;

  function create(items, container) {
    var state = {
      container: container,
      items: items,
      itemsById: {},
      boxes: [],
      undo: [],
      nextId: 1
    };
    (items || []).forEach(function (it) { state.itemsById[it.id] = it; });
    return state;
  }

  function snapshot(state) {
    return state.boxes.map(function (b) { return Object.assign({}, b); });
  }

  function pushUndo(state) {
    state.undo.push(snapshot(state));
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  }

  function clone(box) {
    return Object.assign({}, box);
  }

  /** 放置一只：成功才写模型并计数，被拒绝原样返回原因 */
  function add(state, input) {
    var res = M.tryPlace(input, state.boxes, state.container, state.itemsById);
    if (!res.ok) return res;
    pushUndo(state);
    var box = clone(res.box);
    box.uid = state.nextId++;
    state.boxes.push(box);
    return { ok: true, box: box, snaps: res.snaps };
  }

  /** 移动：同样先试落位，成功才提交 */
  function move(state, uid, x, y, z) {
    var idx = state.boxes.findIndex(function (b) { return b.uid === uid; });
    if (idx < 0) return { ok: false, reason: 'not-found' };
    var cur = state.boxes[idx];
    var others = state.boxes.filter(function (b) { return b.uid !== uid; });
    var input = Object.assign({}, cur, { x: x, y: y, z: z });
    var res = M.tryPlace(input, others, state.container, state.itemsById);
    if (!res.ok) return res;
    pushUndo(state);
    state.boxes[idx] = Object.assign(clone(res.box), { uid: uid });
    return { ok: true, box: state.boxes[idx], snaps: res.snaps };
  }

  function rotate(state, uid, axis) {
    var idx = state.boxes.findIndex(function (b) { return b.uid === uid; });
    if (idx < 0) return { ok: false, reason: 'not-found' };
    var cur = state.boxes[idx];
    var others = state.boxes.filter(function (b) { return b.uid !== uid; });
    var res = M.rotateAndPlace(cur, others, state.container, state.itemsById, axis);
    if (!res.ok) return res;
    pushUndo(state);
    state.boxes[idx] = Object.assign(clone(res.box), { uid: uid });
    return { ok: true, box: state.boxes[idx] };
  }

  /**
   * 复制：优先原位向上叠（上方支撑完整才允许），其次沿贴齐方向找最近空位，
   * 都失败就拒绝——不出现「不知道怎么生成出来一只」。
   */
  function copy(state, uid) {
    var src = state.boxes.find(function (b) { return b.uid === uid; });
    if (!src) return { ok: false, reason: 'not-found' };
    var tries = [
      { x: src.x, y: src.y, z: src.z + src.h },
      { x: src.x, y: src.y, z: 0 }
    ];
    // 四周错开一个箱位再试
    [[src.l, 0], [-src.l, 0], [0, src.w], [0, -src.w]].forEach(function (d) {
      tries.push({ x: src.x + d[0], y: src.y + d[1], z: src.z });
    });
    for (var i = 0; i < tries.length; i++) {
      var input = Object.assign(clone(src), tries[i]);
      delete input.uid;
      var res = M.tryPlace(input, state.boxes, state.container, state.itemsById);
      if (res.ok) {
        pushUndo(state);
        var box = clone(res.box);
        box.uid = state.nextId++;
        state.boxes.push(box);
        return { ok: true, box: box, snaps: res.snaps };
      }
    }
    return { ok: false, reason: 'no-space', message: '上方与四周都没有空位' };
  }

  function remove(state, uid) {
    var idx = state.boxes.findIndex(function (b) { return b.uid === uid; });
    if (idx < 0) return { ok: false, reason: 'not-found' };
    pushUndo(state);
    state.boxes.splice(idx, 1);
    return { ok: true };
  }

  function undo(state) {
    if (!state.undo.length) return { ok: false, reason: 'empty' };
    var prev = state.undo.pop();
    state.boxes = prev;
    return { ok: true, boxes: state.boxes };
  }

  /** 底部计数：以模型为准 */
  function counts(state) {
    var out = {};
    state.boxes.forEach(function (b) {
      out[b.skuId] = (out[b.skuId] || 0) + 1;
    });
    return (state.items || []).map(function (it) {
      return { skuId: it.id, name: it.name, placed: out[it.id] || 0, want: it.qty };
    });
  }

  NS.manualModel = {
    create: create,
    add: add,
    move: move,
    rotate: rotate,
    copy: copy,
    remove: remove,
    undo: undo,
    counts: counts,
    UNDO_LIMIT: UNDO_LIMIT
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.manualModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
