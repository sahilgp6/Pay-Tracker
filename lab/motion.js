/* LAB motion graphics, built on GSAP (vendor/gsap). The app calls PTMotion.enter() only when you arrive at a screen or
   change month, never while you type. Rules borrowed from the Remotion motion skill: no linear easing, entrances move
   on two or three properties at once, everything is staggered, idle things breathe gently. Reduce Motion turns it off. */
(function(){
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const E = { out:"expo.out", soft:"power3.out", pop:"back.out(1.5)", in:"power3.in", io:"power3.inOut" };   // one motion language: things arrive on expo.out, leave on power3.in, move on power3.inOut
  let ok = false;
  function init(){
    if(!window.gsap) return;
    try{ gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin) }catch(e){}
    ok = true; tabs(true);   // the launch intro now lives in intro.js
    // the app drew its first screen before GSAP finished loading: replay that arrival with the full motion
    const v=document.getElementById("view");
    if(v && v.children.length && !RM()){ v.classList.remove("enter","fwd","back"); enter(v, "", null) }
    addEventListener("resize", ()=>tabs(true));
  }

  /* ---------- arriving at a screen ---------- */
  function enter(root, dir, tab){
    if(!ok || RM()) return;
    const kids = [...root.children];
    const dx = dir==="fwd" ? 28 : dir==="back" ? -28 : 0;
    gsap.killTweensOf(kids);
    gsap.fromTo(kids, {autoAlpha:0, x:dx, y:dx?0:16, scale:.985},
      {autoAlpha:1, x:0, y:0, scale:1, duration:.6, ease:E.out, stagger:.055, clearProps:"opacity,visibility,transform"});
    const q = s => [...root.querySelectorAll(s)];
    // list rows ripple in
    const items = q(".item");
    if(items.length) gsap.fromTo(items.slice(0,24), {autoAlpha:0, y:12}, {autoAlpha:1, y:0, duration:.45, ease:E.soft, stagger:.028, delay:.12, clearProps:"opacity,visibility,transform"});
    // tiles pop
    const tiles = q(".tile");
    if(tiles.length) gsap.fromTo(tiles, {autoAlpha:0, scale:.92, y:14}, {autoAlpha:1, scale:1, y:0, duration:.55, ease:E.pop, stagger:.06, delay:.15, clearProps:"opacity,visibility,transform"});
    hero(root); bands(root); ribbons(root); gantts(root); bars(root); map(root); guarantee(root);
  }

  /* ---------- Month hero: odometer and the flight arc ---------- */
  function hero(root){
    const big = root.querySelector(".big[data-odo]");
    if(big) odometer(big);
    const svg = root.querySelector(".hero-arc"); if(!svg) return;
    const path = svg.querySelector(".arc-path"), plane = svg.querySelector(".arc-plane"), dots = svg.querySelectorAll(".arc-dot"), lbl = svg.querySelectorAll(".arc-lbl");
    const tl = gsap.timeline({delay:.25});
    tl.fromTo(dots, {scale:0, transformOrigin:"50% 50%"}, {scale:1, duration:.4, ease:E.pop, stagger:.9})
      .fromTo(lbl, {autoAlpha:0, y:4}, {autoAlpha:1, y:0, duration:.4, ease:E.soft, stagger:.9}, 0)
      .fromTo(path, {drawSVG:"0%"}, {drawSVG:"100%", duration:1.5, ease:"power2.inOut"}, .15)
      .fromTo(plane, {autoAlpha:0}, {autoAlpha:1, duration:.2}, .15)
      .to(plane, {duration:1.5, ease:"power2.inOut", motionPath:{path:path, align:path, alignOrigin:[.5,.5], autoRotate:90}}, .15)
      .add(()=>{ // once landed, the plane idles with a slow drift so the card never looks frozen
        gsap.to(plane, {y:"-=2.5", duration:2.2, ease:"sine.inOut", yoyo:true, repeat:-1});
      });
  }
  let lastOdo=null;
  function odometer(el){
    const txt = el.dataset.odo || el.textContent, prev = lastOdo; lastOdo = txt;
    el.innerHTML = [...txt].map(ch => /\d/.test(ch)
      ? `<span class="odo"><span class="odo-col">${"0123456789".split("").map(n=>`<span>${n}</span>`).join("")}</span></span>`
      : `<span class="odo-sep">${ch}</span>`).join("");
    const cols = [...el.querySelectorAll(".odo-col")], digits = txt.replace(/\D/g,"").split("").map(Number);
    // a month change rolls each digit from last month's figure; the first time, from a scrambled start
    const old = prev && prev.replace(/\D/g,"").length===digits.length ? prev.replace(/\D/g,"").split("").map(Number) : null;
    cols.forEach((c,i)=>{
      const from = old ? old[i] : (digits[i]+5)%10;
      gsap.fromTo(c, {yPercent:-10*from}, {yPercent:-10*digits[i], duration:old?.8+Math.abs(digits[i]-from)*.04:1.1+(cols.length-i)*.06, ease:E.out, delay:old?i*.03:.1+i*.04});
    });
  }

  /* ---------- pay bands: fills grow in order, the marker glides to your hours ---------- */
  function bands(root){
    root.querySelectorAll(".bands").forEach(b=>{
      const fills=b.querySelectorAll("u"), mark=b.querySelector("b");
      gsap.fromTo(fills, {scaleX:0}, {scaleX:(i,el)=>+getComputedStyle(el).getPropertyValue("--f")||0, duration:.7, ease:E.soft, stagger:.12, delay:.2, clearProps:"transform"});
      if(mark){ const to=mark.style.left; gsap.fromTo(mark, {left:"0%", autoAlpha:0}, {left:to, autoAlpha:1, duration:1.3, ease:E.out, delay:.25}) }
    });
  }

  /* ---------- Flights: each day's routing draws itself, station by station ---------- */
  function ribbons(root){
    root.querySelectorAll(".ribbon").forEach((r,ri)=>{
      if(ri>8) return;
      const parts=[...r.children];
      const tl=gsap.timeline({delay:.15+ri*.06});
      parts.forEach(p=>{
        if(p.classList.contains("seg")) tl.fromTo(p, {scaleX:0, transformOrigin:"left center"}, {scaleX:1, duration:.32, ease:E.out});
        else tl.fromTo(p, {autoAlpha:0, scale:.6}, {autoAlpha:1, scale:1, duration:.3, ease:E.pop}, "-=.08");
      });
    });
  }

  /* ---------- Duty: the duty bar fills from report to off duty ---------- */
  function gantts(root){
    root.querySelectorAll(".gantt").forEach(g=>{
      gsap.fromTo(g.querySelectorAll(".gb"), {scaleX:0, transformOrigin:"left center"}, {scaleX:1, duration:.5, ease:E.soft, stagger:.14, delay:.25});
      const now=g.querySelector(".gnow"); if(now) gsap.fromTo(now, {autoAlpha:0, scaleY:0}, {autoAlpha:1, scaleY:1, duration:.4, ease:E.pop, delay:.9});
    });
    root.querySelectorAll(".bar-f").forEach((f,i)=>gsap.fromTo(f, {scaleX:0, transformOrigin:"left center"}, {scaleX:1, duration:.7, ease:E.soft, delay:.2+i*.04, clearProps:"transform"}));
  }

  /* ---------- Year chart bars rise ---------- */
  function bars(root){
    const rects=root.querySelectorAll(".chart rect.bar"); if(!rects.length) return;
    gsap.fromTo(rects, {scaleY:0, transformOrigin:"50% 100%"}, {scaleY:1, duration:.6, ease:E.soft, stagger:.035, delay:.15});
  }

  /* ---------- tab bar: a soft pill slides under the active tab ---------- */
  function tabs(instant){
    const bar=document.querySelector(".tabbar"), ind=bar&&bar.querySelector(".tabind"), on=bar&&bar.querySelector('button[aria-selected="true"]');
    if(!ind||!on) return;
    const x=on.offsetLeft+on.offsetWidth/2-ind.offsetWidth/2;
    if(!ok || instant || RM()){ if(window.gsap) gsap.set(ind,{x, autoAlpha:1}); else ind.style.transform=`translateX(${x}px)`; return }
    gsap.to(ind, {x, autoAlpha:1, duration:.45, ease:E.out});
  }

  /* ---------- a removed row folds away ---------- */
  function fold(el, done){
    if(!ok || RM()){ done(); return }
    const h=el.offsetHeight;
    gsap.timeline({onComplete:done})
      .to(el, {x:-24, autoAlpha:0, duration:.2, ease:E.in})
      .fromTo(el, {height:h}, {height:0, paddingTop:0, paddingBottom:0, marginTop:0, marginBottom:0, duration:.28, ease:E.io});
  }

  /* ---------- saved tick ---------- */
  let savedEl=null, savedT=null, pendingSaved=false;
  function sheetClosed(){ if(pendingSaved){ pendingSaved=false; setTimeout(saved, 280) } }
  function saved(){
    if(document.hidden) return;
    const t=document.getElementById("toast"); if(t && t.classList.contains("show")) return;   // the undo bar already says it
    if(document.documentElement.classList.contains("sheet-open")){ pendingSaved=true; return }  // the sheet covers the bottom; show it when the sheet closes
    if(!savedEl){ savedEl=document.createElement("div"); savedEl.className="savedpill"; savedEl.setAttribute("aria-hidden","true");
      savedEl.innerHTML=`<svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7"/></svg><span>Saved</span>`; document.body.appendChild(savedEl) }
    const path=savedEl.querySelector("path");
    clearTimeout(savedT);
    if(!ok || RM()){ savedEl.style.opacity=1; savedT=setTimeout(()=>savedEl.style.opacity=0, 1200); return }
    gsap.killTweensOf([savedEl,path]);
    gsap.timeline().fromTo(savedEl,{autoAlpha:0,y:-8,scale:.9},{autoAlpha:1,y:0,scale:1,duration:.3,ease:E.pop})
      .fromTo(path,{drawSVG:"0%"},{drawSVG:"100%",duration:.4,ease:E.out},.05)
      .to(savedEl,{autoAlpha:0,y:-6,duration:.3,ease:E.in},1.3);
  }

  /* ---------- crossing the 40 h guarantee: once per month, a small burst at the 40 mark ---------- */
  function guarantee(root){
    const b=root.querySelector(".bands"), badge=root.querySelector(".bhead .badge.ok"); if(!b||!badge) return;
    const ym=(document.getElementById("mLabel")||{}).textContent||"", key="crewpaylog.lab.g40";
    let seen=[]; try{ seen=JSON.parse(localStorage.getItem(key)||"[]") }catch(e){}
    if(seen.includes(ym)) return; seen.push(ym); try{ localStorage.setItem(key, JSON.stringify(seen.slice(-24))) }catch(e){}
    const seg=b.children[0], r=seg.getBoundingClientRect(), host=b.getBoundingClientRect();
    const x=r.right-host.left, y=r.height/2, cols=["#e2c27f","#7fb08f","#8fb3e8","#d98b5f"];
    for(let i=0;i<18;i++){ const p=document.createElement("i"); p.className="spark"; p.style.left=x+"px"; p.style.top=y+"px"; p.style.background=cols[i%4]; b.appendChild(p);
      const a=Math.random()*Math.PI*2, d=20+Math.random()*34;
      gsap.fromTo(p,{scale:0,autoAlpha:1},{x:Math.cos(a)*d, y:Math.sin(a)*d-10, scale:1, autoAlpha:0, duration:.9+Math.random()*.4, ease:"power3.out", delay:1.1, onComplete:()=>p.remove()}) }
    const lab=document.createElement("span"); lab.className="g40"; lab.textContent="Guarantee reached"; badge.after(lab);
    sweep(b.closest(".card")||b, 1.05);
    gsap.timeline({delay:1.15}).fromTo(badge,{scale:1},{scale:1.12,duration:.18,ease:"power2.out",yoyo:true,repeat:1})
      .fromTo(lab,{autoAlpha:0,y:6},{autoAlpha:1,y:0,duration:.35,ease:E.pop},0).to(lab,{autoAlpha:0,duration:.4},2.4).add(()=>lab.remove());
  }

  /* ---------- route map: routes draw one by one, then a few planes keep flying them ---------- */
  function map(root){
    const svg=root.querySelector(".mapbox svg"); if(!svg) return;
    const rts=[...svg.querySelectorAll(".rt")], sts=svg.querySelectorAll(".st");
    gsap.fromTo(svg.querySelectorAll(".land,.india"),{autoAlpha:0},{autoAlpha:1,duration:.6,ease:E.soft,delay:.1});
    gsap.fromTo(sts,{autoAlpha:0,scale:0,transformOrigin:"50% 100%"},{autoAlpha:1,scale:1,duration:.4,ease:E.pop,stagger:.05,delay:.3});
    gsap.fromTo(rts,{drawSVG:"0%"},{drawSVG:"100%",duration:.9,ease:E.io,stagger:.12,delay:.45});
    planesOn(svg, 1.2);
  }
  function planesOn(svg, delay){
    const rts=[...svg.querySelectorAll(".rt")];
    const vb=svg.viewBox.baseVal, sz=vb.width*.022;
    rts.slice(0,16).forEach((r,i)=>{
      const dh=r.classList.contains("dh");
      const g=document.createElementNS("http://www.w3.org/2000/svg","g"); g.setAttribute("class","mplane"+(dh?" dh":""));
      g.innerHTML=`<path transform="scale(${(sz/8).toFixed(3)})" d="M0-8c.5 0 .9.4.9 1v4.6l6.6 3.8v1.7L.9 1.1v3.6l2 1.5V7.6L0 6.8l-2.9.8V6.2l2-1.5V1.1l-6.6 2V1.4l6.6-3.8V-7c0-.6.4-1 .9-1z"/>`;
      svg.appendChild(g);
      // out and back like a real rotation: nose first both ways, a short turnaround at each end
      // each route gets its own plane; length sets the pace, so short hops turn round sooner
      const len=r.getTotalLength(), dur=Math.max(4.7, Math.min(12.6, len/vb.width*25)), tl=gsap.timeline({repeat:-1, delay:delay+(i%6)*.45});
      // on the ground the jet is gone: it shrinks away as it lands, waits, and grows back as it rolls
      const hold=1.4, grow=dur*.35, leg=(from,to)=>{
        const t0=tl.duration();
        tl.to(g,{duration:dur, ease:"power1.inOut", motionPath:{path:r, align:r, alignOrigin:[.5,.5], autoRotate:90, start:from, end:to}}, t0)
          .fromTo(g,{scale:0},{scale:1, duration:grow, ease:"sine.out"}, t0).fromTo(g,{autoAlpha:0},{autoAlpha:1, duration:.15}, t0)   // grows through the climb
          .to(g,{scale:0, duration:grow, ease:"sine.in"}, t0+dur-grow).to(g,{autoAlpha:0, duration:.15}, t0+dur-.15)   // shrinks down the approach, gone at touchdown
          .set(g,{}, t0+dur+hold);
      };
      tl.set(g,{scale:0, autoAlpha:0, transformOrigin:"50% 50%"}); leg(0,1); leg(1,0);
    });
  }

  /* ---------- rest countdown ticks without redrawing the screen ---------- */
  setInterval(()=>{
    document.querySelectorAll(".rest .rtxt").forEach(t=>{
      const a=+t.dataset.restA, b=+t.dataset.restB, now=Date.now(), left=b-now, el=t.querySelector(".rleft"), ring=t.parentNode.querySelector(".rt1");
      if(left<=0){ el.textContent="Rest complete"; if(ring) ring.style.strokeDashoffset=0; return }
      const m=Math.ceil(left/60000); el.textContent=Math.floor(m/60)+":"+String(m%60).padStart(2,"0");
      if(ring) ring.style.strokeDashoffset=(100-Math.min(100,(now-a)/(b-a)*100)).toFixed(1);
    });
  }, 15000);

  /* ---------- iOS-style title: the big title gives way to a slim bar as you scroll ---------- */
  let cbar=null;
  function onScroll(){
    if(!cbar){ cbar=document.createElement("div"); cbar.className="cbar"; cbar.setAttribute("aria-hidden","true"); document.body.appendChild(cbar) }
    const h1=document.getElementById("scrTitle"), lab=document.getElementById("labbar"); if(!h1) return;
    const top=h1.getBoundingClientRect().bottom, off=lab?lab.getBoundingClientRect().bottom:0;
    cbar.style.top=Math.max(0,off)+"px";
    const on=top<off+6; if(on) cbar.textContent=h1.textContent;
    cbar.classList.toggle("on", on);
    // day chips on Flights stick just under the slim title (or the lab bar)
    document.documentElement.style.setProperty("--dtop", (Math.max(0,off)+(on?44:0)+8)+"px");
  }
  addEventListener("scroll", onScroll, {passive:true});

  /* ---------- swipe left or right: months on Month, Flights and Pay; days on Duty ---------- */
  (function(){
    let x0=null, y0=null, dx=0, lock=null, el=null;
    const blocked=t=>t.closest(".dstrip,.fchips,.tbl,input,select,textarea,.sheet,.mapbox,.tabbar,#labbar");
    document.addEventListener("touchstart",e=>{ const v=document.getElementById("view"); if(!v||!v.contains(e.target)||blocked(e.target)) return;
      x0=e.touches[0].clientX; y0=e.touches[0].clientY; dx=0; lock=null; el=v },{passive:true});
    document.addEventListener("touchmove",e=>{ if(x0==null) return; const mx=e.touches[0].clientX-x0, my=e.touches[0].clientY-y0;
      if(lock==null && (Math.abs(mx)>10||Math.abs(my)>10)) lock=Math.abs(mx)>Math.abs(my)*1.4?"x":"y";
      if(lock!=="x") return; dx=mx; if(!RM()) el.style.transform=`translateX(${dx*.35}px)` },{passive:true});
    document.addEventListener("touchend",()=>{ if(x0==null) return; const d=dx, l=lock; x0=null;
      if(el){ if(window.gsap && !RM()) gsap.to(el,{x:0,duration:.3,ease:E.out,onComplete:()=>{el.style.transform=""}}); else el.style.transform="" }
      if(l!=="x" || Math.abs(d)<70) return;
      const tabOn=document.querySelector('.tabbar [aria-selected="true"]'), t=tabOn&&tabOn.dataset.tab;
      if(t==="duty"){ const on=document.querySelector("#dstrip .ds.on"); let n=on&&(d<0?on.nextElementSibling:on.previousElementSibling);
        while(n && !n.matches(".ds")) n=d<0?n.nextElementSibling:n.previousElementSibling; if(n) n.click() }
      else if(t==="month"||t==="log"||t==="pay"){ const b=document.getElementById(d<0?"nextM":"prevM"); if(b) b.click() }
    });
  })();

  /* ---------- tapping a tile or a Year bar opens it into its screen ---------- */
  function expandFrom(el){
    if(!ok||RM()) return; const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
    const o=document.createElement("div"); o.className="expander";
    Object.assign(o.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px",borderRadius:cs.borderRadius==="0px"?"12px":cs.borderRadius,background:el.matches(".bar")?getComputedStyle(document.documentElement).getPropertyValue("--fill"):cs.backgroundColor});
    document.body.appendChild(o);
    gsap.timeline({onComplete:()=>o.remove()})
      .to(o,{left:0,top:0,width:innerWidth,height:innerHeight,borderRadius:0,duration:.42,ease:E.io})
      .to(o,{autoAlpha:0,duration:.28,ease:E.soft});
  }
  document.addEventListener("click",e=>{ const t=e.target.closest(".chart rect.bar"); if(t) expandFrom(t) }, true);   // the map card has its own loading sequence

  function idle(root){ if(!ok||RM()) return; const svg=root.querySelector(".mapbox svg"); if(svg && !svg.querySelector(".mplane")) planesOn(svg, 0) }

  /* ---------- everyday actions (same motion language as Ledger) ---------- */
  const can=()=>ok && !RM() && window.gsap;
  // a field that needs filling gives a short shake
  function shake(el){ if(!el) return; el.classList.remove("needs"); void el.offsetWidth; el.classList.add("needs"); setTimeout(()=>el.classList.remove("needs"),1400);
    if(can()) gsap.fromTo(el,{x:0},{keyframes:{x:[0,-9,8,-6,4,0]}, duration:.42, ease:"power1.out", clearProps:"transform"}) }
  // one band of light crosses a card
  function sweep(el, delay=0){ if(!can()||!el) return; const o=document.createElement("i"); o.className="lightsweep";
    if(getComputedStyle(el).position==="static") el.style.position="relative"; const ov=el.style.overflow; el.style.overflow="hidden"; el.appendChild(o);
    gsap.fromTo(o,{xPercent:-160},{xPercent:520, duration:1.05, ease:"power2.inOut", delay, onComplete:()=>{ o.remove(); el.style.overflow=ov }}) }
  // a button fills with a quick wipe before its action lands
  function wipe(btn){ if(!can()||!btn) return Promise.resolve(); const o=document.createElement("i"); o.className="btnwipe";
    btn.style.position="relative"; btn.style.overflow="hidden"; btn.appendChild(o);
    return new Promise(res=>gsap.fromTo(o,{xPercent:-101},{xPercent:0, duration:.26, ease:E.io, onComplete:res})) }
  // the back of a tile: heading, then the money lands with a small pop, then the note under it
  function steps(box){ if(!can()||!box) return; const parts=[...box.children]; if(!parts.length) return; const d0=.26;
    gsap.fromTo(parts,{autoAlpha:0,y:8},{autoAlpha:1,y:0, duration:.32, ease:E.soft, stagger:.09, delay:d0, clearProps:"opacity,visibility,transform"});
    box.querySelectorAll(".tline b").forEach((v,k)=>gsap.fromTo(v,{scale:1.3,transformOrigin:"right center"},{scale:1, duration:.6, ease:E.out, delay:d0+.12+k*.09, clearProps:"transform"})) }
  // rows the roster just brought in slide in lit up
  function lit(before){ if(!can()||!before) return; const els=[...document.querySelectorAll("#view [data-sheet]")].filter(el=>!before.has(el.dataset.sheet)).slice(0,12);
    els.forEach((el,i)=>{ el.classList.add("litrow"); setTimeout(()=>el.classList.remove("litrow"),2200) });
    if(els.length) gsap.fromTo(els,{autoAlpha:0,x:24},{autoAlpha:1,x:0, duration:.45, ease:E.out, stagger:.06, delay:.15, clearProps:"opacity,visibility,transform"}) }
  // a day opens out of the chip you tapped
  function fromCell(rect, el){ if(!can()||!rect||!el) return; const r=el.getBoundingClientRect(); if(!r.width) return;
    const sx=rect.width/r.width, sy=rect.height/r.height;
    gsap.fromTo(el,{x:rect.left-r.left, y:rect.top-r.top, scaleX:sx, scaleY:sy, transformOrigin:"0 0", autoAlpha:.4, borderRadius:14},
      {x:0, y:0, scaleX:1, scaleY:1, autoAlpha:1, duration:.5, ease:"expo.out", clearProps:"transform,opacity,visibility,borderRadius"}) }
  window.PTMotion = { ready:()=>ok && !RM(), fresh:()=>{ lastOdo=null }, enter, idle, tabs:()=>{ tabs(false); onScroll() }, fold, saved, sheetClosed, shake, sweep, wipe, steps, lit, fromCell };
  if(document.readyState==="complete" || document.readyState==="interactive") setTimeout(init,0); else document.addEventListener("DOMContentLoaded", init);
})();
