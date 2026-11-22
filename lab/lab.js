/* LAB bar: marks this as the test copy, switches the look, and copies your real data in (read-only on the real copy). */
(function(){
  const BUILD=82;
  const LOOK="crewpaylog.lab.look", REAL="crewpaylog.v1", LAB="crewpaylog.lab.v1";
  const get=k=>{ try{ return localStorage.getItem(k) }catch(e){ return null } };
  const set=(k,v)=>{ try{ localStorage.setItem(k,v); return true }catch(e){ return false } };
  const apply=l=>{ document.documentElement.classList.toggle("look-a", l==="a") };
  let look="a"; apply(look);   // the revamp is the lab's design now
  function bar(){
    const b=document.createElement("div"); b.id="labbar";
    b.innerHTML=`<b>LAB COPY</b><span>not your real app · build ${BUILD}</span><span class="sp"></span>
      <button id="labCopy">Copy my real data in</button>`;
    document.body.prepend(b);
    const mark=()=>b.querySelectorAll("[data-look]").forEach(x=>x.classList.toggle("on", x.dataset.look===look));
    mark();
    b.addEventListener("click",e=>{
      const t=e.target.closest("button"); if(!t) return;
      if(t.dataset.look){ look=t.dataset.look; set(LOOK,look); apply(look); mark(); return }
      if(t.id==="labCopy"){
        const real=get(REAL);
        if(!real){ alert("No real Pay Tracker data found in this browser. Open the real app in Safari once, or restore a backup here in Setup."); return }
        if(!confirm("Replace the lab's data with a copy of your real app's data? Your real app is not changed.")) return;
        set(LAB, real); set(LAB+".year", get(REAL+".year")||"cal"); location.reload();
      }
    });
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",bar); else bar();
  // Safari can keep showing an old copy of the lab. Ask the server which build is current and jump to it if this one is behind.
  const check=()=>fetch("lab.js?t="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.text():"").then(t=>{
    const m=t.match(/const BUILD=(\d+)/); if(m && +m[1]>BUILD) location.replace(location.pathname+"?b="+m[1]+location.hash) }).catch(()=>{});
  check(); document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") check() });
})();
