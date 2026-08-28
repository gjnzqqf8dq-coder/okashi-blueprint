/* おかしの設計図 ── 出題ロジック
 *
 * index.json を読み、来場者の5つの答え（各0〜8）から1件を選ぶ。
 *
 * 設計の要点
 *   ・612件は回答分布に合わせて配置してあるが、最近傍で引くと5.3倍の偏りが残る。
 *     各件が持つ w（実測確率の逆数）を抽選の重みにして、これを均す。
 *   ・直近に出したものは候補から外す。隣にいる友達と同じものが出ると台無しになるため。
 *   ・除外しすぎて候補が尽きたときは、古い履歴から順に解放する。止まらないことを優先。
 */
(function (global) {
  "use strict";

  function Picker(index) {
    this.items = index.items;
    var sel = index.select || {};
    this.topK = sel.topK || 12;
    this.decay = (sel.decay === undefined) ? 0.05 : sel.decay;   // index.json 側の値に従う
    this.recentMax = sel.recentExclude || 60;
    this.recent = [];          // 直近に出した id。新しいものが先頭
  }

  /** 答え同士の距離。二乗和のままで比較する（平方根は順序を変えないので取らない） */
  Picker.prototype._dist2 = function (a, b) {
    var s = 0;
    for (var i = 0; i < 5; i++) {
      var d = a[i] - b[i];
      s += d * d;
    }
    return s;
  };

  /**
   * @param {number[]} answer 5つの答え（各0〜8）
   * @returns {object} 選ばれた item
   */
  Picker.prototype.pick = function (answer) {
    var self = this;

    // 距離順に並べる
    var ranked = this.items
      .map(function (it) { return { it: it, d: self._dist2(answer, it.a) }; })
      .sort(function (x, y) { return x.d - y.d; });

    // 直近に出したものを外しながら、上位 topK 件を集める。
    // 足りなければ除外の窓を狭めて、必ず候補が残るようにする
    var excl = this.recent.length;
    var pool = [];
    while (pool.length === 0 && excl >= 0) {
      var ban = new Set(this.recent.slice(0, excl));
      pool = [];
      for (var i = 0; i < ranked.length && pool.length < this.topK; i++) {
        if (!ban.has(ranked[i].it.id)) pool.push(ranked[i]);
      }
      if (pool.length === 0) excl = Math.floor(excl / 2) - 1;
    }
    if (pool.length === 0) pool = ranked.slice(0, this.topK);   // 最後の砦

    // w を重みに抽選する。近いものほど有利にしたいので、距離で少し減衰させる
    var weights = pool.map(function (p) {
      return p.it.w / (1 + p.d * self.decay);
    });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * total;
    var idx = 0;
    for (var j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) { idx = j; break; }
    }
    var chosen = pool[idx].it;

    // 履歴に積む
    this.recent.unshift(chosen.id);
    if (this.recent.length > this.recentMax) this.recent.length = this.recentMax;

    return chosen;
  };

  /** 展示のリセット用 */
  Picker.prototype.reset = function () { this.recent = []; };

  global.OkashiPicker = Picker;
})(typeof window !== "undefined" ? window : globalThis);
