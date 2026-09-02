/* ============================================================
   おかしの設計図 / OKASHI BLUEPRINT ── 持ち帰り用カード
   ------------------------------------------------------------
   QRの先で出すのは「袋の写真」ではなく「標本図（specimen plate）」。
   1080×1350（4:5）。Instagram/LINE に貼っても切られない比率。

   window.OKB_CARD.render(opts) -> Promise<HTMLCanvasElement>

   opts = { id, name, lead, body, imgUrl, axes:[{ja,v}×9], kind, struct }

   外部依存なし。module でもない。<script src="card.js"> で読む。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 寸法 ---------- */
  var W = 1080, H = 1350;
  var M = 76;                    // 版面の余白
  var CW = W - M * 2;            // 版面のよこ幅 = 928

  /* ---------- 色 ---------- */
  var INK = '#0d1117';
  var SUB = '#7b8595';
  var LINE = 'rgba(13,30,60,.14)';
  var GRID = 'rgba(13,40,90,.035)';
  var RETICLE = 'rgba(13,30,60,.22)';
  var CYAN = '#00a2c7';
  var PAPER = '#ffffff';

  /* ---------- 書体 ---------- */
  var JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif';
  var MO = '"SF Mono",ui-monospace,Menlo,monospace';
  function jp(weight, size) { return weight + ' ' + size + 'px ' + JP; }
  function mo(weight, size) { return weight + ' ' + size + 'px ' + MO; }

  /* 行頭に置かない文字 / 行末に置かない文字（簡易禁則） */
  var NO_START = '。、）」』】〕》〉！？・ー…‥,.:;!?)]}〟”';
  var NO_END = '（「『【〔《〈([{“〝';

  /* ============================================================
     小さな道具
     ============================================================ */

  /* letter-spacing は canvas に無い。1文字ずつ送り幅を足して自分で描く */
  function spacedWidth(ctx, str, sp) {
    var w = 0;
    for (var i = 0; i < str.length; i++) w += ctx.measureText(str[i]).width + sp;
    return str.length ? w - sp : 0;
  }
  function drawSpaced(ctx, str, x, y, sp) {
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      ctx.fillText(str[i], cx, y);
      cx += ctx.measureText(str[i]).width + sp;
    }
    return cx - (str.length ? sp : 0);
  }
  function drawSpacedRight(ctx, str, right, y, sp) {
    drawSpaced(ctx, str, right - spacedWidth(ctx, str, sp), y, sp);
  }

  /* 日本語の折り返し。1文字ずつ測って箱の右端で折る */
  function wrapJP(ctx, text, maxW) {
    var src = String(text == null ? '' : text);
    var out = [], cur = '';
    var paras = src.split(/\r?\n/);
    for (var p = 0; p < paras.length; p++) {
      cur = '';
      var s = paras[p];
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (cur === '') { cur = ch; continue; }
        if (ctx.measureText(cur + ch).width <= maxW) { cur += ch; continue; }
        /* 行頭禁則: この文字は次行の頭に来られないので、はみ出させて今の行に留める */
        if (NO_START.indexOf(ch) >= 0) { cur += ch; continue; }
        /* 行末禁則: 直前が開き括弧なら、それごと次行へ送る */
        var last = cur.charAt(cur.length - 1);
        if (NO_END.indexOf(last) >= 0 && cur.length > 1) {
          out.push(cur.slice(0, -1));
          cur = last + ch;
        } else {
          out.push(cur);
          cur = ch;
        }
      }
      out.push(cur);
    }
    return out;
  }

  function hairline(ctx, x1, y, x2, color) {
    ctx.strokeStyle = color || LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, Math.round(y) + 0.5);
    ctx.lineTo(x2, Math.round(y) + 0.5);
    ctx.stroke();
  }

  function loadImage(url) {
    return new Promise(function (res) {
      if (!url) { res(null); return; }
      var im = new Image();
      var done = false;
      var fin = function (v) { if (!done) { done = true; res(v); } };
      im.onload = function () { fin(im); };
      im.onerror = function () { fin(null); };
      /* 同一オリジンなので crossOrigin は不要。付けると file:// で壊れる */
      im.src = url;
      /* 念のための保険。写真が来なくてもカードは出す */
      setTimeout(function () { fin(im.complete && im.naturalWidth ? im : null); }, 12000);
    });
  }

  function fontsReady() {
    try {
      if (global.document && document.fonts && document.fonts.ready) {
        return document.fonts.ready.then(function () { return true; },
          function () { return true; });
      }
    } catch (e) { }
    return Promise.resolve(true);
  }

  /* ============================================================
     背景 ── 方眼とレティクル（本体アプリの drawBG と同じ作り）
     ============================================================ */
  function drawGround(ctx) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    var gs = 60;
    ctx.beginPath();
    for (var x = gs; x < W; x += gs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = gs; y < H; y += gs) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    ctx.strokeStyle = RETICLE;
    ctx.lineWidth = 1;
    var m = 38, L = 17;
    var pts = [[m, m], [W - m, m], [m, H - m], [W - m, H - m], [W / 2, m], [W / 2, H - m]];
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0] + 0.5, py = pts[i][1] + 0.5;
      ctx.moveTo(px - L, py); ctx.lineTo(px + L, py);
      ctx.moveTo(px, py - L); ctx.lineTo(px, py + L);
    }
    ctx.stroke();
  }

  /* ============================================================
     パッケージ写真
     ------------------------------------------------------------
     素材は白地のJPEG。そのまま置くと白い箱が浮く。
     multiply で重ねると白は透けて紙の地と一体になる（本体アプリと同じ手）。
     ============================================================ */
  /* 素材は 1024×1024 の白地。中身は真ん中に小さく写っている。
     そのまま貼ると「切手」になるので、白でない範囲を測って、そこだけを使う。
     同一オリジンなので getImageData が通る。通らない環境では全面にもどす */
  function trimWhite(img) {
    var full = { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
    try {
      var S = 220;
      var ar = img.naturalWidth / img.naturalHeight;
      var sw = ar >= 1 ? S : Math.max(1, Math.round(S * ar));
      var sh = ar >= 1 ? Math.max(1, Math.round(S / ar)) : S;
      var c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff'; x.fillRect(0, 0, sw, sh);
      x.drawImage(img, 0, 0, sw, sh);
      var d = x.getImageData(0, 0, sw, sh).data;
      var TH = 242;                       // これより明るい画素は「紙」とみなす
      var minx = sw, miny = sh, maxx = -1, maxy = -1;
      for (var yy = 0; yy < sh; yy++) {
        for (var xx = 0; xx < sw; xx++) {
          var i = (yy * sw + xx) * 4;
          if (d[i] < TH || d[i + 1] < TH || d[i + 2] < TH) {
            if (xx < minx) minx = xx;
            if (xx > maxx) maxx = xx;
            if (yy < miny) miny = yy;
            if (yy > maxy) maxy = yy;
          }
        }
      }
      if (maxx < 0) return full;
      var w = maxx - minx + 1, h = maxy - miny + 1;
      /* ほぼ全面が絵柄なら、切る意味がない */
      if (w > sw * 0.94 && h > sh * 0.94) return full;
      /* 逆に極端に小さいときは、拾い損ね（薄い袋）を疑って切らない */
      if (w < sw * 0.06 || h < sh * 0.06) return full;
      var pad = 0.02;                     // 断ち落としの手前で少し余白を残す
      var nx = Math.max(0, minx / sw - pad), ny = Math.max(0, miny / sh - pad);
      var nw = Math.min(1 - nx, w / sw + pad * 2), nh = Math.min(1 - ny, h / sh + pad * 2);
      return {
        sx: nx * img.naturalWidth, sy: ny * img.naturalHeight,
        sw: nw * img.naturalWidth, sh: nh * img.naturalHeight
      };
    } catch (e) { return full; }
  }

  function drawPackage(ctx, img, bx, by, bw, bh) {
    if (!img || !img.naturalWidth) return null;
    var t = trimWhite(img);
    var ar = t.sw / t.sh;
    var w = bw, h = bw / ar;
    if (h > bh) { h = bh; w = bh * ar; }
    var x = bx + (bw - w) / 2, y = by + (bh - h) / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    try { ctx.filter = 'brightness(1.07) contrast(1.05)'; } catch (e) { }
    ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, x, y, w, h);
    try { ctx.filter = 'none'; } catch (e) { }
    ctx.restore();
    return { x: x, y: y, w: w, h: h };
  }

  /* 写真の四隅にごく細いL字。図面の当たりに見せる */
  function cornerTicks(ctx, r) {
    if (!r) return;
    var a = 20, o = 14;
    var x1 = r.x - o, y1 = r.y - o, x2 = r.x + r.w + o, y2 = r.y + r.h + o;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var c = [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]];
    for (var i = 0; i < c.length; i++) {
      var px = Math.round(c[i][0]) + 0.5, py = Math.round(c[i][1]) + 0.5;
      ctx.moveTo(px + c[i][2] * a, py); ctx.lineTo(px, py); ctx.lineTo(px, py + c[i][3] * a);
    }
    ctx.stroke();
  }

  /* ============================================================
     本体
     ============================================================ */
  function render(opts) {
    opts = opts || {};
    var id = String(opts.id == null ? '' : opts.id);
    var name = String(opts.name || '');
    var lead = String(opts.lead || '');
    var body = String(opts.body || '');
    var kind = String(opts.kind || '');
    var struct = String(opts.struct || '');
    var axes = Array.isArray(opts.axes) ? opts.axes.slice(0, 9) : [];

    return Promise.all([loadImage(opts.imgUrl), fontsReady()]).then(function (r) {
      var img = r[0];

      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      ctx.textBaseline = 'alphabetic';

      drawGround(ctx);

      /* ---------- ヘッダ ---------- */
      ctx.fillStyle = INK;
      ctx.font = mo(700, 19);
      drawSpaced(ctx, 'OKASHI BLUEPRINT', M, 104, 5.0);

      ctx.fillStyle = CYAN;
      ctx.font = mo(700, 19);
      drawSpacedRight(ctx, 'NO.' + (id || '----'), W - M, 104, 3.2);

      hairline(ctx, M, 130, W - M);

      /* ---------- 下から先に決める（footer / 味の設計値） ---------- */
      var footRuleY = 1268;
      var footBase = 1302;
      var axRowPitch = 46;
      var axTop = 1074;                 // 3行 × 46 = 138 → 1212 まで
      var capBase = 1058;               // 小見出しのベースライン
      var rule2Y = 1030;                // 本文と味の設計値のあいだの罫

      /* ---------- 本文の高さを先に測る ---------- */
      var NAME_MAX = 62, LEAD_SIZE = 28, BODY_SIZE = 21;
      var META_H = 20, GAP_META = 24, GAP_NAME = 20, GAP_LEAD = 18;
      var nameSize, nameLS, leadLines, bodyLines, leadLH, bodyLH, textH;

      function measure(bodySize, leadSize) {
        /* 商品名: 幅に収まるまで詰める */
        nameSize = NAME_MAX;
        nameLS = 0;
        for (var g = 0; g < 40; g++) {
          ctx.font = jp(800, nameSize);
          nameLS = nameSize * 0.07;
          if (spacedWidth(ctx, name, nameLS) <= CW || nameSize <= 30) break;
          nameSize -= 2;
        }
        ctx.font = jp(700, leadSize);
        leadLines = lead ? wrapJP(ctx, lead, CW) : [];
        ctx.font = jp(400, bodySize);
        bodyLines = body ? wrapJP(ctx, body, CW) : [];
        leadLH = Math.round(leadSize * 1.52);
        bodyLH = Math.round(bodySize * 1.62);
        textH = META_H + GAP_META + Math.round(nameSize * 1.06)
          + (leadLines.length ? GAP_NAME + leadLines.length * leadLH : 0)
          + (bodyLines.length ? GAP_LEAD + bodyLines.length * bodyLH : 0);
        return textH;
      }

      var bs = BODY_SIZE, ls = LEAD_SIZE;
      measure(bs, ls);
      /* どうしても入らない長文は、崩さず文字を落として収める */
      var guard = 0;
      while (textH > 446 && guard++ < 14) {
        if (ls > 23) ls -= 1;
        if (bs > 17) bs -= 1;
        measure(bs, ls);
        if (ls <= 23 && bs <= 17) break;
      }

      /* ---------- 写真の帯 ----------
         文が短ければ写真を伸ばし、長ければ写真を縮める。
         余白は下にためず、必ず写真に返す（白い穴を作らない） */
      var photoTop = 156;
      var textGap = 34;
      var hasImg = !!(img && img.naturalWidth);
      var slack = (rule2Y - 30) - textGap - textH - photoTop;
      var bandH;
      if (hasImg) {
        bandH = Math.min(644, slack);
        if (bandH < 340) bandH = 340;
      } else {
        /* 写真が来なかったとき。帯を潰し、文をおおよそ天地の中央に置く */
        bandH = Math.max(40, Math.min(300, slack * 0.42));
      }
      var photoBottom = photoTop + bandH;

      var box = drawPackage(ctx, img, M, photoTop, CW, photoBottom - photoTop);
      cornerTicks(ctx, box);

      /* ---------- 本文 ---------- */
      var y = photoBottom + textGap;

      /* 種類 ／ 断面 の極小ラベル */
      var meta = [];
      if (kind) meta.push(kind);
      if (struct) meta.push(struct);
      ctx.fillStyle = SUB;
      ctx.font = jp(400, 15);
      if (meta.length) drawSpaced(ctx, meta.join('　／　'), M, y + 15, 2.4);
      ctx.font = mo(400, 13);
      drawSpacedRight(ctx, 'SPECIMEN', W - M, y + 15, 3.4);
      y += META_H + GAP_META;

      /* 商品名 */
      ctx.fillStyle = INK;
      ctx.font = jp(800, nameSize);
      drawSpaced(ctx, name, M, y + nameSize * 0.80, nameLS);
      y += Math.round(nameSize * 1.06);

      /* 発明の一行 */
      if (leadLines.length) {
        y += GAP_NAME;
        ctx.fillStyle = INK;
        ctx.font = jp(700, ls);
        for (var i = 0; i < leadLines.length; i++) {
          ctx.fillText(leadLines[i], M, y + ls * 0.82 + i * leadLH);
        }
        y += leadLines.length * leadLH;
      }

      /* 本文 */
      if (bodyLines.length) {
        y += GAP_LEAD;
        ctx.fillStyle = SUB;
        ctx.font = jp(400, bs);
        for (var j = 0; j < bodyLines.length; j++) {
          ctx.fillText(bodyLines[j], M, y + bs * 0.82 + j * bodyLH);
        }
        y += bodyLines.length * bodyLH;
      }

      /* ---------- 味の設計値 ---------- */
      hairline(ctx, M, rule2Y, W - M);
      ctx.fillStyle = SUB;
      ctx.font = mo(400, 12.5);
      drawSpaced(ctx, 'TASTE PROFILE', M, capBase, 3.6);
      ctx.font = jp(400, 12.5);
      drawSpacedRight(ctx, '設計値 0–100', W - M, capBase, 2.0);

      var colGap = 34;
      var colW = (CW - colGap * 2) / 3;
      for (var k = 0; k < 9; k++) {
        var a = axes[k] || { ja: '', v: 0 };
        var v = Math.max(0, Math.min(100, Math.round(Number(a.v) || 0)));
        var col = k % 3, row = (k / 3) | 0;
        var cx = M + col * (colW + colGap);
        var cy = axTop + row * axRowPitch;

        ctx.fillStyle = INK;
        ctx.font = jp(400, 17);
        ctx.fillText(String(a.ja || ''), cx, cy + 14);

        ctx.fillStyle = INK;
        ctx.font = mo(700, 16);
        var vs = (v < 10 ? '0' : '') + v;
        drawSpacedRight(ctx, vs, cx + colW, cy + 14, 1.2);

        ctx.fillStyle = LINE;
        ctx.fillRect(cx, cy + 26, colW, 3);
        ctx.fillStyle = CYAN;
        ctx.fillRect(cx, cy + 26, colW * (v / 100), 3);
      }

      /* ---------- 奥付 ---------- */
      hairline(ctx, M, footRuleY, W - M);
      ctx.fillStyle = SUB;
      ctx.font = jp(400, 14);
      drawSpaced(ctx, 'おかしの設計図 / 藝祭2026 — 東京藝術大学', M, footBase, 1.6);
      ctx.font = mo(400, 13.5);
      drawSpacedRight(ctx, 'gjnzqqf8dq-coder.github.io/okashi-blueprint', W - M, footBase, 0.6);

      return cv;
    });
  }

  global.OKB_CARD = { render: render };
})(this);
