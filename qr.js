/* qr.js — 依存ゼロのQRコード生成器（プレーンES5・byteモード・version 1〜20）
 * <script src="qr.js"> で読むだけ。ビルド・CDN・import 一切不要。オフライン動作。
 * 公開API: window.QR = { encode, toCanvas, toSVG }
 * 規格: ISO/IEC 18004（モデル2）
 */
(function (global) {
  'use strict';

  var MAX_VERSION = 20;

  /* 1ブロックあたりの誤り訂正コードワード数。添字は [ECレベル][型番]（0番は未使用のダミー） */
  var ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28]
  };
  /* 誤り訂正ブロック数。データはこの数に分割され、後でインターリーブされる */
  var NUM_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25]
  };
  /* 形式情報に埋め込むECレベルの2bit表現（数値の大小と順序が一致しないので表で持つ） */
  var FORMAT_ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* ---------------- 低レベルのユーティリティ ---------------- */

  /* 文字列をUTF-8バイト列へ。ASCIIはそのまま、それ以外は自前でエンコード（TextEncoder非依存） */
  function toUtf8Bytes(str) {
    var out = [], i, c, j;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      /* サロゲートペアを1つのコードポイントへ合成 */
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      j = 0;
    }
    return out;
  }

  /* 型番から「機能パターンを除いた総モジュール数」を求める。8で割ると総コードワード数 */
  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55; /* 位置合わせパターンの占有分 */
      if (ver >= 7) result -= 36;                     /* 型番情報 18bit × 2箇所 */
    }
    return result;
  }
  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }
  /* byteモードの文字数指示子のビット長。型番10以上で16bitに広がる */
  function charCountBits(ver) { return ver <= 9 ? 8 : 16; }

  /* ---------------- GF(256) と Reed-Solomon ---------------- */

  /* GF(256)の乗算。原始多項式 x^8+x^4+x^3+x^2+1 (0x11D) で都度還元する筆算方式 */
  function gfMul(a, b) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = ((z << 1) ^ ((z >>> 7) * 0x11D)) & 0xFF;
      z ^= ((b >>> i) & 1) * a;
      z &= 0xFF;
    }
    return z;
  }
  /* 生成多項式 (x-α^0)(x-α^1)...(x-α^(degree-1)) の係数（最高次は1なので省略） */
  function rsDivisor(degree) {
    var result = [], i, j;
    for (i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  /* データ多項式を生成多項式で割った剰余＝ECコードワード */
  function rsRemainder(data, divisor) {
    var result = [], i, j;
    for (i = 0; i < divisor.length; i++) result.push(0);
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  /* データコードワードをブロック分割 → 各ブロックにEC付与 → 規格順にインターリーブ */
  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = NUM_BLOCKS[ecl][ver];
    var blockEcc = ECC_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    /* 短いブロックの数と長さ。長いブロックは短いブロック+1コードワード */
    var numShort = numBlocks - rawCodewords % numBlocks;
    var shortLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(blockEcc);
    var blocks = [], i, j, k = 0;
    for (i = 0; i < numBlocks; i++) {
      var len = shortLen - blockEcc + (i < numShort ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      /* 短いブロックにはダミー1個を足して全ブロックの長さを揃える（走査を単純化するため） */
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (j = 0; j < blocks.length; j++) {
        /* 短いブロックに足したダミーの位置だけ読み飛ばす */
        if (i !== shortLen - blockEcc || j >= numShort) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  /* ---------------- QRシンボルの構築 ---------------- */

  function QRMatrix(ver, ecl, dataCodewords) {
    this.version = ver;
    this.ecl = ecl;
    this.size = ver * 4 + 17;
    var i, j;
    this.modules = [];   /* 明暗（true=暗） */
    this.isFunc = [];    /* 機能パターンならtrue（データ配置とマスクの対象外） */
    for (i = 0; i < this.size; i++) {
      var row = [], frow = [];
      for (j = 0; j < this.size; j++) { row.push(false); frow.push(false); }
      this.modules.push(row); this.isFunc.push(frow);
    }
    this.drawFunctionPatterns();
    var allCodewords = addEccAndInterleave(dataCodewords, ver, ecl);
    this.drawCodewords(allCodewords);
    /* 8種のマスクを全部試し、ペナルティ点が最小のものを採用する */
    var bestMask = 0, minPenalty = Infinity;
    for (i = 0; i < 8; i++) {
      this.applyMask(i);
      this.drawFormatBits(i);
      var p = this.penaltyScore();
      if (p < minPenalty) { minPenalty = p; bestMask = i; }
      this.applyMask(i); /* XORなので同じマスクを再適用すると元に戻る */
    }
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
    this.mask = bestMask;
  }

  QRMatrix.prototype.setFunc = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunc[y][x] = true;
  };

  QRMatrix.prototype.drawFunctionPatterns = function () {
    var size = this.size, i;
    /* タイミングパターン（6行目・6列目の交互ドット） */
    for (i = 0; i < size; i++) { this.setFunc(6, i, i % 2 === 0); this.setFunc(i, 6, i % 2 === 0); }
    /* 位置検出パターン3つ（分離パターンを含む9x9として一括で描く） */
    this.drawFinder(3, 3); this.drawFinder(size - 4, 3); this.drawFinder(3, size - 4);
    /* 位置合わせパターン。3隅の位置検出パターンと重なる組み合わせだけ除外する */
    var pos = this.alignPositions(), n = pos.length, j;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlign(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0); /* 実際の値は後で入るが、領域を機能パターンとして予約しておく */
    this.drawVersion();
  };

  QRMatrix.prototype.drawFinder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)); /* チェビシェフ距離＝リングの番号 */
        var x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunc(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  QRMatrix.prototype.drawAlign = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };
  /* 位置合わせパターンの中心座標。6から始まり、末尾からstep間隔で等分される */
  QRMatrix.prototype.alignPositions = function () {
    var ver = this.version;
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var p = this.size - 7; result.length < numAlign; p -= step) result.splice(1, 0, p);
    return result;
  };

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  /* 形式情報15bit（ECレベル2bit + マスク3bit + BCH(15,5) 10bit、0x5412でXOR）を2箇所に書く */
  QRMatrix.prototype.drawFormatBits = function (mask) {
    var data = (FORMAT_ECL_BITS[this.ecl] << 3) | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = this.size;
    for (i = 0; i <= 5; i++) this.setFunc(8, i, getBit(bits, i));
    this.setFunc(8, 7, getBit(bits, 6));
    this.setFunc(8, 8, getBit(bits, 7));
    this.setFunc(7, 8, getBit(bits, 8));
    for (i = 9; i < 15; i++) this.setFunc(14 - i, 8, getBit(bits, i));
    for (i = 0; i < 8; i++) this.setFunc(size - 1 - i, 8, getBit(bits, i));
    for (i = 8; i < 15; i++) this.setFunc(8, size - 15 + i, getBit(bits, i));
    this.setFunc(8, size - 8, true); /* 常に暗のモジュール */
  };

  /* 型番7以上のみ、型番情報18bit（6bit + BCH(18,6)）を左下と右上に書く */
  QRMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem;
    for (i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = this.size - 11 + i % 3, b = Math.floor(i / 3);
      this.setFunc(a, b, bit);
      this.setFunc(b, a, bit);
    }
  };

  /* コードワード列を右下から2列ずつ、上下に蛇行させながら空きモジュールへ流し込む */
  QRMatrix.prototype.drawCodewords = function (data) {
    var i = 0, size = this.size, right, vert, j, x, y, upward;
    for (right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; /* 6列目は縦のタイミングパターンなので飛ばす */
      for (vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - vert : vert;
          if (!this.isFunc[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QRMatrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (this.isFunc[y][x]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  /* 規格の4つの減点規則。合計が最小になるマスクが「読みやすい」とみなされる */
  QRMatrix.prototype.penaltyScore = function () {
    var size = this.size, result = 0, x, y, i;
    var FINDER = [true, false, true, true, true, false, true, false, false, false, false]; /* 1011101 0000 */
    /* 規則1: 同色5連以上（5個で3点、以降1個ごとに+1） */
    for (y = 0; y < size; y++) {
      var runColor = this.modules[y][0], runLen = 1;
      for (x = 1; x < size; x++) {
        if (this.modules[y][x] === runColor) { runLen++; }
        else { if (runLen >= 5) result += 3 + (runLen - 5); runColor = this.modules[y][x]; runLen = 1; }
      }
      if (runLen >= 5) result += 3 + (runLen - 5);
    }
    for (x = 0; x < size; x++) {
      var rc = this.modules[0][x], rl = 1;
      for (y = 1; y < size; y++) {
        if (this.modules[y][x] === rc) { rl++; }
        else { if (rl >= 5) result += 3 + (rl - 5); rc = this.modules[y][x]; rl = 1; }
      }
      if (rl >= 5) result += 3 + (rl - 5);
    }
    /* 規則2: 2x2の同色ブロック1つにつき3点 */
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = this.modules[y][x];
        if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) result += 3;
      }
    }
    /* 規則3: 位置検出パターンに似た 1:1:3:1:1 + 空白4 の並び1つにつき40点（前後どちら向きも） */
    for (y = 0; y < size; y++) {
      for (x = 0; x + 10 < size; x++) {
        var fwd = true, bwd = true;
        for (i = 0; i < 11; i++) {
          if (this.modules[y][x + i] !== FINDER[i]) fwd = false;
          if (this.modules[y][x + i] !== FINDER[10 - i]) bwd = false;
        }
        if (fwd) result += 40;
        if (bwd) result += 40;
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y + 10 < size; y++) {
        var f2 = true, b2 = true;
        for (i = 0; i < 11; i++) {
          if (this.modules[y + i][x] !== FINDER[i]) f2 = false;
          if (this.modules[y + i][x] !== FINDER[10 - i]) b2 = false;
        }
        if (f2) result += 40;
        if (b2) result += 40;
      }
    }
    /* 規則4: 暗モジュール比率が50%から5%離れるごとに10点 */
    var dark = 0, total = size * size;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (this.modules[y][x]) dark++;
    result += Math.floor(Math.abs(dark * 100 / total - 50) / 5) * 10;
    return result;
  };

  /* ---------------- 公開API ---------------- */

  function encode(text, ecl) {
    ecl = ecl || 'M';
    if (!ECC_PER_BLOCK[ecl]) throw new Error('QR: unknown ECC level ' + ecl);
    var bytes = toUtf8Bytes(String(text));
    /* 収まる最小の型番を探す（文字数指示子のビット長が型番で変わるので毎回計算する） */
    var ver = 0, capacityBits = 0, i;
    for (i = 1; i <= MAX_VERSION; i++) {
      capacityBits = numDataCodewords(i, ecl) * 8;
      if (4 + charCountBits(i) + bytes.length * 8 <= capacityBits) { ver = i; break; }
    }
    if (ver === 0) throw new Error('QR: data too long (max version ' + MAX_VERSION + ')');

    /* ビット列を組み立てる: モード指示子0100 + 文字数 + データ本体 */
    var bits = [];
    function appendBits(val, len) { for (var b = len - 1; b >= 0; b--) bits.push((val >>> b) & 1); }
    appendBits(4, 4);
    appendBits(bytes.length, charCountBits(ver));
    for (i = 0; i < bytes.length; i++) appendBits(bytes[i], 8);
    /* 終端子（最大4bit）→ バイト境界まで0詰め → 余りを 0xEC/0x11 の交互で埋める */
    appendBits(0, Math.min(4, capacityBits - bits.length));
    appendBits(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

    var codewords = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    var qr = new QRMatrix(ver, ecl, codewords);
    return {
      size: qr.size,
      version: qr.version,
      mask: qr.mask,
      ecl: ecl,
      modules: qr.modules,
      get: function (x, y) {
        if (x < 0 || y < 0 || x >= qr.size || y >= qr.size) return false;
        return qr.modules[y][x];
      }
    };
  }

  function opt(o, k, d) { return (o && o[k] !== undefined && o[k] !== null) ? o[k] : d; }

  function toCanvas(canvas, text, opts) {
    opts = opts || {};
    var px = opt(opts, 'px', 260);
    var margin = opt(opts, 'margin', 4);
    var dpr = opt(opts, 'dpr', 1);
    var dark = opt(opts, 'dark', '#0d1117');
    var light = opt(opts, 'light', '#ffffff');
    var code = encode(text, opt(opts, 'ecl', 'M'));
    var total = code.size + margin * 2;
    var W = Math.round(px * dpr);
    canvas.width = W; canvas.height = W;
    if (canvas.style) { canvas.style.width = px + 'px'; canvas.style.height = px + 'px'; }
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = light; ctx.fillRect(0, 0, W, W);
    /* モジュールを整数ピクセルに揃えて描き、端数は左右均等に振って中央寄せする */
    var cell = Math.floor(W / total) || 1;
    var off = Math.floor((W - cell * total) / 2);
    ctx.fillStyle = dark;
    for (var y = 0; y < code.size; y++) {
      for (var x = 0; x < code.size; x++) {
        if (code.get(x, y)) ctx.fillRect(off + (x + margin) * cell, off + (y + margin) * cell, cell, cell);
      }
    }
    return code;
  }

  function toSVG(text, opts) {
    opts = opts || {};
    var margin = opt(opts, 'margin', 4);
    var px = opt(opts, 'px', 260);
    var dark = opt(opts, 'dark', '#0d1117');
    var light = opt(opts, 'light', '#ffffff');
    var code = encode(text, opt(opts, 'ecl', 'M'));
    var total = code.size + margin * 2, parts = [];
    for (var y = 0; y < code.size; y++) {
      for (var x = 0; x < code.size; x++) {
        if (code.get(x, y)) parts.push('M' + (x + margin) + ' ' + (y + margin) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + parts.join('') + '"/></svg>';
  }

  global.QR = { encode: encode, toCanvas: toCanvas, toSVG: toSVG };
})(typeof window !== 'undefined' ? window : this);
