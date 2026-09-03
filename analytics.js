/* ============================================================
   来場者の動きの記録
   ------------------------------------------------------------
   置き場が2つある。

   1) その端末の localStorage（従来どおり）
      会場の iPad 用。Wi-Fi が切れても記録は落ちない。
      読むのは同じオリジンの dash-8f3a21c7.html。

   2) 送信先（OKB_ENDPOINT があるときだけ）
      配布用は「配った先のスマホ」で動く。記録がその端末に貯まっても
      こちらからは一生読めないので、まとめて送る。
      送るのは sendBeacon。画面を閉じられても落ちない。
      回線が無ければ黙って諦める（体験は絶対に止めない）。

   個人を特定するものは取らない。取るのは
   「いつ・どの画面で・何を押したか・そこに何秒いたか」だけ。
   端末に振る番号は毎回同じ人を数え直さないためのランダムな文字列で、
   氏名・メール・位置・広告IDのたぐいには一切触れていない。
   ============================================================ */
(function(){
  var KEY='okb.log', SKEY='okb.sid', VKEY='okb.vid', QKEY='okb.q', CAP=40000;
  var buf=[], sid=0, timer=null, dead=false;
  var BOOT=Date.now(), lastAt=BOOT;
  var out=[], sending=false, otimer=null;          // 送信待ちの控え

  /* ---------- 端末の番号（ランダム。個人情報ではない） ---------- */
  function vid(){
    var v='';
    try{ v=localStorage.getItem(VKEY)||''; }catch(e){}
    if(!v){
      v='';
      var s='abcdefghijklmnopqrstuvwxyz0123456789';
      for(var i=0;i<12;i++) v+=s.charAt(Math.floor(Math.random()*s.length));
      try{ localStorage.setItem(VKEY,v); }catch(e){}
    }
    return v;
  }
  /* ---------- 端末の種類。機種特定はしない ---------- */
  function kind(){
    var u=(navigator.userAgent||'').toLowerCase();
    if(/ipad/.test(u) || (/macintosh/.test(u) && navigator.maxTouchPoints>1)) return 'ipad';
    if(/iphone|ipod/.test(u)) return 'iphone';
    if(/android/.test(u)) return /mobile/.test(u) ? 'android' : 'android-tab';
    return 'pc';
  }
  /* ---------- どこから来たか。ホスト名だけ ---------- */
  function ref(){
    try{
      if(!document.referrer) return '';
      var h=new URL(document.referrer).hostname;
      return h===location.hostname ? '' : h;
    }catch(e){ return ''; }
  }

  function load(){
    try{ var s=localStorage.getItem(KEY); buf = s ? JSON.parse(s) : []; }
    catch(e){ buf=[]; }
    if(!Array.isArray(buf)) buf=[];
    try{ sid = parseInt(localStorage.getItem(SKEY)||'0',10)||0; }catch(e){ sid=0; }
    /* 前回、送りきれずに残ったぶんを拾う（電波が無いまま閉じられた回） */
    try{ var q=localStorage.getItem(QKEY); if(q){ out=JSON.parse(q)||[]; } }catch(e){ out=[]; }
    if(!Array.isArray(out)) out=[];
  }
  /* 書き込みは間引く。1タップごとに数MBを書き直すと、
     回答の連打で描画が引っかかる（iPadで実際に出た） */
  function flush(){
    if(dead) return;
    timer=null;
    try{ localStorage.setItem(KEY, JSON.stringify(buf)); }
    catch(e){
      // 容量いっぱい。古い方から3割捨てて、もう一度だけ試す
      buf=buf.slice(Math.floor(buf.length*0.3));
      try{ localStorage.setItem(KEY, JSON.stringify(buf)); }
      catch(e2){ dead=true; console.warn('記録を止めた（保存できない）',e2); }
    }
  }
  function schedule(){ if(!timer) timer=setTimeout(flush,900); }

  /* ---------- 送信 ---------- */
  function saveQueue(){ try{ localStorage.setItem(QKEY, JSON.stringify(out.slice(-800))); }catch(e){} }
  function envelope(evs){
    return {
      v: vid(),
      m: (window.STAND ? 'stand' : 'phone'),
      k: kind(),
      w: (screen && screen.width)  || innerWidth  || 0,
      h: (screen && screen.height) || innerHeight || 0,
      lang: (navigator.language||'').slice(0,5),
      ref: ref(),
      tz: new Date().getTimezoneOffset(),
      b: BOOT,
      e: evs
    };
  }
  function send(force){
    var url = window.OKB_ENDPOINT;
    if(!url || !out.length || sending) return;
    /* 溜まりすぎない限りは、まとめてから送る（電池と回線のため） */
    if(!force && out.length < 6) { if(!otimer) otimer=setTimeout(function(){ otimer=null; send(true); }, 15000); return; }
    if(otimer){ clearTimeout(otimer); otimer=null; }
    var batch = out.slice(0, 300);
    var body  = JSON.stringify(envelope(batch));
    var ok=false;
    try{
      if(navigator.sendBeacon){
        ok = navigator.sendBeacon(url, new Blob([body], {type:'text/plain;charset=utf-8'}));
      }
    }catch(e){ ok=false; }
    if(!ok){
      try{
        fetch(url, {method:'POST', mode:'no-cors', keepalive:true,
                    headers:{'Content-Type':'text/plain;charset=utf-8'}, body:body});
        ok=true;
      }catch(e){ ok=false; }
    }
    if(ok){ out = out.slice(batch.length); saveQueue(); }
    /* 失敗しても何もしない。次の機会にまた送る。体験は絶対に止めない */
  }

  load();

  var A = {
    /* 体験の区切り。「つくる」を押すたびに新しい番号になる */
    newSession:function(){
      sid++;
      try{ localStorage.setItem(SKEY,String(sid)); }catch(e){}
      return sid;
    },
    sid:function(){ return sid; },
    vid: vid,
    log:function(name, payload){
      if(dead) return;
      var now=Date.now();
      var ev={t:now, s:sid, e:name};
      if(payload) for(var k in payload) if(Object.prototype.hasOwnProperty.call(payload,k)) ev[k]=payload[k];
      buf.push(ev);
      if(buf.length>CAP) buf=buf.slice(buf.length-CAP);
      schedule();

      /* 送信用は別の控えに積む。t は起動からの経過、d は直前の記録からの滞在 */
      var o={t:now-BOOT, d:now-lastAt, s:sid, e:name};
      if(payload) for(var k2 in payload) if(Object.prototype.hasOwnProperty.call(payload,k2)) o[k2]=payload[k2];
      lastAt=now;
      out.push(o); saveQueue();
      /* 体験の終わりと離脱は取りこぼしたくないので、その場で送る */
      if(name==='end' || name==='idle' || name==='res') send(true); else send(false);
    },
    all:function(){ return buf.slice(); },
    /* 画面を閉じられる前に書き切る／送り切る */
    flushNow:function(){ if(timer){ clearTimeout(timer); timer=null; } flush(); send(true); },
    clear:function(){ buf=[]; out=[]; try{ localStorage.removeItem(KEY); localStorage.removeItem(QKEY); }catch(e){} },
    pending:function(){ return out.length; }
  };

  addEventListener('pagehide', A.flushNow);
  addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') A.flushNow(); });

  window.OKB = A;
})();
