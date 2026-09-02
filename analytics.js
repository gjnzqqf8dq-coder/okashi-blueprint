/* ============================================================
   来場者の動きの記録 ── 会場に回線が無くても落ちない作り
   ------------------------------------------------------------
   展示は iPad 1台で回る。サーバは無いし、会場のWi-Fiは切れる前提。
   だから記録は全部その端末の localStorage に置く。
   読むのは同じオリジンに置いた dash.html（開発者用）だけ。

   個人を特定するものは一切取らない。取るのは
   「いつ・どの画面で・どのボタンを押したか」だけ。
   ============================================================ */
(function(){
  var KEY='okb.log', SKEY='okb.sid', CAP=40000;   // 3日でこの数は超えない（1体験≒15件）
  var buf=[], sid=0, timer=null, dead=false;

  function load(){
    try{ var s=localStorage.getItem(KEY); buf = s ? JSON.parse(s) : []; }
    catch(e){ buf=[]; }
    if(!Array.isArray(buf)) buf=[];
    try{ sid = parseInt(localStorage.getItem(SKEY)||'0',10)||0; }catch(e){ sid=0; }
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

  load();

  var A = {
    /* 体験の区切り。「つくる」を押すたびに新しい番号になる */
    newSession:function(){
      sid++;
      try{ localStorage.setItem(SKEY,String(sid)); }catch(e){}
      return sid;
    },
    sid:function(){ return sid; },
    log:function(name, payload){
      if(dead) return;
      var ev={t:Date.now(), s:sid, e:name};
      if(payload) for(var k in payload) if(Object.prototype.hasOwnProperty.call(payload,k)) ev[k]=payload[k];
      buf.push(ev);
      if(buf.length>CAP) buf=buf.slice(buf.length-CAP);
      schedule();
    },
    all:function(){ return buf.slice(); },
    /* 画面を閉じられる前に書き切る */
    flushNow:function(){ if(timer){ clearTimeout(timer); timer=null; } flush(); },
    clear:function(){ buf=[]; try{ localStorage.removeItem(KEY); }catch(e){} }
  };

  addEventListener('pagehide', A.flushNow);
  addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') A.flushNow(); });

  window.OKB = A;
})();
