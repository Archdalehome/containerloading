/*
 * 本单体检：结果页底部的四项自查数字。
 *
 * 用户报"箱子相互侵入 / 超出柜底"这类问题时，不用再猜参数——按下计算后这一栏就在结果页底部，
 * 哪一项不是 0 就标红，并写明是哪一层、哪个 SKU、哪一箱、哪个坐标、差多少。
 *
 * 四项（全部必须为 0）：
 *   1. 越界箱数     渲染几何的 AABB 必须落在柜内腔 [0,L]×[0,W]×[0,H] 里（容差 1mm）
 *   2. 两两重叠     渲染 AABB 两两不相交（对扣一对、缺口嵌合箱按物理豁免，另按实体检查）
 *   3. 悬空箱数     每箱下方必须有完整水平支撑（来自 pack.validatePhysics）
 *   4. 渲染偏差     渲染 AABB 与占位矩形的最大偏差（每边缩 4mm 视觉缝）
 *
 * 数据来自真实 3D 场景（window.CL3D._state 里的 InstancedMesh 几何 + 实例矩阵），
 * 不看排布数据，所以"数据对、渲染错"也能抓到。
 */
(function (root) {
  'use strict';

  var NS = (root.CL = root.CL || {});

  function fmt(n) {
    return (Math.round(n * 10) / 10).toLocaleString('zh-CN');
  }

  function nameOf(item) {
    return item.name ? item.name : item.shapeName + ' #' + (item.index + 1);
  }

  /** 渲染实例的容器坐标 AABB：[x0,x1] 长、[y0,y1] 宽、[z0,z1] 高 */
  function aabbOf(geometry, matrix, c) {
    var T = root.CL3D.THREE;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    var bb = geometry.boundingBox.clone().applyMatrix4(matrix);
    return {
      x0: bb.min.x + c.innerL / 2,
      x1: bb.max.x + c.innerL / 2,
      // three 的 z 轴 = 容器宽度，y 轴 = 容器高度
      y0: bb.min.z + c.innerW / 2,
      y1: bb.max.z + c.innerW / 2,
      z0: bb.min.y,
      z1: bb.max.y
    };
  }

  function isPairMate(a, b) {
    if (a.layer !== b.layer) return false;
    var pa = a.kind === 'pair-lower' && (b.kind === 'pair-upper' || b.kind === 'pair-upper-l');
    var pb = (a.kind === 'pair-upper' || a.kind === 'pair-upper-l') && b.kind === 'pair-lower';
    return (pa || pb) && a.x === b.x && a.y === b.y;
  }

  function isNotchMate(a, b) {
    return a.layer === b.layer && (a.kind === 'notch' || b.kind === 'notch');
  }

  function inspect(pack) {
    var c = pack.container;
    var itemsById = {};
    pack.items.forEach(function (it) { itemsById[it.id] = it; });

    var out = {
      badRender: 0,
      overlaps: [],
      floating: [],
      maxErr: 0,
      maxErrWhere: '',
      boxes: 0,
      rendered: false,
      physics: []
    };

    // 渲染层：几何 AABB 与占位矩形比、与柜内腔比
    var st = root.CL3D && root.CL3D.isReady && root.CL3D.isReady() ? root.CL3D._state : null;
    if (st && st.meshes && st.meshes.length) {
      var T = root.CL3D.THREE;
      var map = {};
      var order = [];
      pack.placements.forEach(function (p) {
        var k = p.skuId + '|' + p.layer + '|' + (p.pose ? p.pose.join(',') : '');
        if (!map[k]) { map[k] = []; order.push(k); }
        map[k].push(p);
      });
      var m4 = new T.Matrix4();
      var list = [];
      st.meshes.forEach(function (mesh, gi) {
        var ps = map[order[gi]];
        if (!ps) return;
        for (var i = 0; i < mesh.count && i < ps.length; i++) {
          mesh.getMatrixAt(i, m4);
          var a = aabbOf(mesh.geometry, m4, c);
          list.push({ a: a, p: ps[i] });
          out.boxes++;
        }
      });
      out.rendered = true;

      list.forEach(function (rec) {
        var a = rec.a;
        var p = rec.p;
        var it = itemsById[p.skuId];
        var label = '第 ' + (p.layer + 1) + ' 层 · ' + (it ? nameOf(it) : p.skuId) +
          ' · x=' + fmt(p.x) + ' y=' + fmt(p.y) + ' z=' + fmt(p.z);
        // 与占位矩形比（视觉缝 4mm 已从几何里扣掉）
        var err = Math.max(
          Math.abs((a.x0 + a.x1) / 2 - (p.x + p.l / 2)),
          Math.abs((a.y0 + a.y1) / 2 - (p.y + p.w / 2)),
          Math.abs((a.z0 + a.z1) / 2 - (p.z + p.h / 2)),
          Math.abs((a.x1 - a.x0) - Math.max(0, p.l - 4)),
          Math.abs((a.y1 - a.y0) - Math.max(0, p.w - 4)),
          Math.abs((a.z1 - a.z0) - Math.max(0, p.h - 4))
        );
        if (err > out.maxErr) { out.maxErr = err; out.maxErrWhere = label; }
        // 与柜内腔比
        var over = Math.max(
          -a.x0, a.x1 - c.innerL,
          -a.y0, a.y1 - c.innerW,
          -a.z0, a.z1 - c.innerH
        );
        if (over > 1) {
          out.badRender++;
          if (out.badRender === 1) {
            var axis = '';
            if (-a.x0 > 1) axis = '起点超出柜门 ' + fmt(-a.x0) + ' mm';
            else if (a.x1 - c.innerL > 1) axis = '长度越界 ' + fmt(a.x1 - c.innerL) + ' mm';
            else if (-a.y0 > 1) axis = '宽度起点越界 ' + fmt(-a.y0) + ' mm';
            else if (a.y1 - c.innerW > 1) axis = '宽度越界 ' + fmt(a.y1 - c.innerW) + ' mm';
            else if (-a.z0 > 1) axis = '低于柜底 ' + fmt(-a.z0) + ' mm';
            else axis = '高于柜顶 ' + fmt(a.z1 - c.innerH) + ' mm';
            out.firstBadRender = label + ' — ' + axis;
          }
        }
      });

      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var A = list[i];
          var B = list[j];
          if (isPairMate(A.p, B.p) || isNotchMate(A.p, B.p)) continue;
          var ox = Math.min(A.a.x1, B.a.x1) - Math.max(A.a.x0, B.a.x0);
          var oy = Math.min(A.a.y1, B.a.y1) - Math.max(A.a.y0, B.a.y0);
          var oz = Math.min(A.a.z1, B.a.z1) - Math.max(A.a.z0, B.a.z0);
          if (ox > 1 && oy > 1 && oz > 1) {
            out.overlaps.push({
              a: A.p, b: B.p,
              depth: Math.min(ox, Math.min(oy, oz)),
              layer: A.p.layer
            });
          }
        }
      }
    }

    // 数据层：悬空 / 斜面承重 / 对扣贴合
    if (NS.pack && NS.pack.validatePhysics) {
      var errs = NS.pack.validatePhysics(pack);
      errs.forEach(function (e) {
        if (e.code === 'floating' || e.code === 'slope-top-loaded') out.floating.push(e);
        else out.physics.push(e);
      });
    }

    return out;
  }

  function render(pack) {
    var host = document.getElementById('health-box');
    if (!host || !pack) return;
    var r;
    try {
      r = inspect(pack);
    } catch (e) {
      host.innerHTML = '<div class="health-title">本单体检</div><p class="health-line bad">体检跑不起来：' +
        String(e && e.message ? e.message : e) + '</p>';
      return;
    }

    var ok = r.badRender === 0 && r.overlaps.length === 0 && r.floating.length === 0 &&
      r.maxErr <= 1 && r.physics.length === 0;

    var html = '<div class="health-title">本单体检 <span class="health-sub">（四项都应为 0；有红项时把这张截图发给我就能定位）</span></div>';
    html += '<div class="health-grid">';
    html += '<div class="health-cell' + (r.badRender ? ' bad' : '') + '"><span class="health-num">' + r.badRender +
      '</span><span class="health-label">越界箱数</span></div>';
    html += '<div class="health-cell' + (r.overlaps.length ? ' bad' : '') + '"><span class="health-num">' +
      r.overlaps.length + '</span><span class="health-label">两两重叠（对）</span></div>';
    html += '<div class="health-cell' + (r.floating.length ? ' bad' : '') + '"><span class="health-num">' +
      r.floating.length + '</span><span class="health-label">悬空 / 压斜面（箱）</span></div>';
    html += '<div class="health-cell' + (r.maxErr > 1 ? ' bad' : '') + '"><span class="health-num">' +
      fmt(r.maxErr) + '<small> mm</small></span><span class="health-label">渲染与占位最大偏差</span></div>';
    html += '</div>';

    html += '<p class="health-line' + (r.rendered ? '' : ' muted') + '">' +
      (r.rendered
        ? '已检查 ' + r.boxes.toLocaleString('zh-CN') + ' 个渲染实例（几何 AABB 逐箱量，容差 1mm）。'
        : '3D 还没生成，这四项只校验了数据层。') + '</p>';

    if (r.badRender) {
      html += '<p class="health-line bad">首例：' + r.firstBadRender + '</p>';
    }
    if (r.overlaps.length) {
      var o = r.overlaps[0];
      var itA = null;
      pack.items.forEach(function (it) { if (it.id === o.a.skuId) itA = it; });
      var itB = null;
      pack.items.forEach(function (it) { if (it.id === o.b.skuId) itB = it; });
      html += '<p class="health-line bad">首例：第 ' + (o.layer + 1) + ' 层 · ' +
        (itA ? nameOf(itA) : o.a.skuId) + '(' + o.a.kind + ') 与 ' +
        (itB ? nameOf(itB) : o.b.skuId) + '(' + o.b.kind + ') 穿插 ' + fmt(o.depth) + ' mm</p>';
    }
    if (r.floating.length) {
      var f = r.floating[0];
      var p = f.placement || {};
      html += '<p class="health-line bad">首例：第 ' + ((p.layer || 0) + 1) + ' 层 · ' + f.message +
        '（x=' + fmt(p.x || 0) + ' y=' + fmt(p.y || 0) + ' z=' + fmt(p.z || 0) + '）</p>';
    }
    if (r.physics.length) {
      html += '<p class="health-line bad">另有 ' + r.physics.length + ' 处物理校验问题：' +
        r.physics[0].message + '</p>';
    }
    if (ok) {
      html += '<p class="health-line good">全部通过：渲染 AABB 都在柜内、互不穿插，没有悬空箱。</p>';
    }
    host.innerHTML = html;
    host.className = 'health' + (ok ? ' is-ok' : ' is-bad');
  }

  NS.ui = NS.ui || {};
  NS.ui.health = { render: render, inspect: inspect };
})(typeof globalThis !== 'undefined' ? globalThis : this);
