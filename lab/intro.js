/* Pay Tracker intro: plays when the app is opened fresh (not when you come back to it), about 13 seconds; tap anywhere to skip.
   One flight from Delhi to Mumbai told by the instruments: N1 to take-off thrust, rotation on the PFD, gear up, the climb,
   the ILS 27 approach into Mumbai with its mode changes, the approach lights, stabilised at 1000 ft, then the touchdown in 3D
   and the name. Built from the prototype in the session's scratchpad by make_intro.py; drawn in SVG, timed as one
   function of time so every frame is exact. Reduce Motion shows the final frame. Off with localStorage "<key>.intro" = "off". */
(function(){
  try{ if(localStorage.getItem("crewpaylog.lab.intro")==="off" || /[?&]nointro/.test(location.search)){ document.documentElement.classList.remove("pti-wait"); return } }catch(e){}
  const RMQ=matchMedia("(prefers-reduced-motion: reduce)").matches, DKM=matchMedia("(prefers-color-scheme: dark)").matches;
  const PAL=DKM?{bg:"#10141b",ink:"#ebe7dc",grid:"rgba(235,231,220,.05)",cc:"rgba(235,231,220,.5)",ghost:"235,231,220"}
             :{bg:"#f5f2ea",ink:"#1b2230",grid:"rgba(27,34,48,.07)",cc:"rgba(27,34,48,.55)",ghost:"27,34,48"};
  const css=document.createElement("style"); css.textContent=`
@font-face{font-family:"News";font-weight:500;font-display:block;src:url(fonts/newsreader-latin-500.woff2) format("woff2")}
@font-face{font-family:"News";font-weight:400;font-display:block;src:url(fonts/newsreader-latin-400.woff2) format("woff2")}
@font-face{font-family:"B612M";font-weight:400;font-display:block;src:url(fonts/b612-mono-latin-400.woff2) format("woff2")}
@font-face{font-family:"B612M";font-weight:700;font-display:block;src:url(fonts/b612-mono-latin-700.woff2) format("woff2")}
#pti{position:fixed;inset:0;z-index:2147483000;overflow:hidden;background:${PAL.bg};font-family:"News",serif;color:#1b2230;-webkit-user-select:none;user-select:none;touch-action:none}
#pti *{box-sizing:border-box}
#pti .pti-stage{position:absolute;left:0;top:0;width:390px;height:844px;transform-origin:0 0}
#pti .page{position:absolute;inset:0;background:${PAL.bg};background-image:linear-gradient(${PAL.grid} 1px,transparent 1px),linear-gradient(90deg,${PAL.grid} 1px,transparent 1px);background-size:26px 26px}
#pti .corner{position:absolute;font:400 8px "B612M",monospace;letter-spacing:.08em}
#pti .mono{font-family:"B612M",monospace}
#pti .board{position:absolute;left:16px;top:70px;width:358px;height:704px;display:grid;grid-template-columns:1fr 1fr;transform-origin:50% 50%}
#pti .t{position:relative;overflow:hidden;padding:12px 12px}
#pti .t .no{font:400 8.5px/1.5 "B612M",monospace;letter-spacing:.04em;opacity:.8}
#pti .t h3{margin:0;font:500 34px/1 "News",serif;letter-spacing:-.02em;position:absolute;left:12px;bottom:10px}
#pti .wide{grid-column:1/3}
#pti svg{display:block}
#pti .blur{filter:blur(5px)}`;
  document.head.appendChild(css);
  const ROOT=document.createElement("div"); ROOT.id="pti"; ROOT.setAttribute("role","img"); ROOT.setAttribute("aria-label","Pay Tracker. Tap to skip.");
  const STAGE=document.createElement("div"); STAGE.className="pti-stage"; ROOT.appendChild(STAGE); document.body.appendChild(ROOT);
  document.documentElement.classList.remove("pti-wait");
  // fit the 390 x 844 design inside the safe area
  const probe=document.createElement("div"); probe.style.cssText="position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
  document.body.appendChild(probe); const cs=getComputedStyle(probe), sT=parseFloat(cs.paddingTop)||0, sB=parseFloat(cs.paddingBottom)||0; probe.remove();
  // full width, centred vertically; the two readouts sit just above the home indicator
  const SC=innerWidth/390, OX=0, OY=(innerHeight-844*SC)/2, PB=Math.max(14, ((OY+844*SC)-(innerHeight-sB))/SC+10);
  STAGE.style.transform=`translate(${OX}px,${OY}px) scale(${SC})`;
/* Pay Tracker intro, draft 2. render(t) draws the exact frame for t seconds (scrub or play). */
const C={cream:"#f5f2ea",paper:"#fbf9f4",ink:"#1b2230",night:"#0b0f16",navy:"#1f3f6e",gold:"#d2b377",dgold:"#7a6232",stone:"#ddd5c5"};
// cockpit display colours, used only inside the screens (as on the real PFD and EIS)
const K={wht:"#f4f4f2",grn:"#3fdc6a",mag:"#ff4fd8",cyn:"#4fd2ff",amb:"#ffb02e",red:"#ff3b30",tape:"#5b5f66",sky:"#2f80d8",gnd:"#7b4a22",blk:"#000"};
const W="#f3f0e8";
const cl=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)), lerp=(a,b,u)=>a+(b-a)*u, seg=(t,a,b)=>cl((t-a)/(b-a));
const eo=x=>1-Math.pow(1-x,3), eio=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2, e5=x=>x<.5?16*x**5:1-Math.pow(-2*x+2,5)/2, ex=x=>x>=1?1:1-Math.pow(2,-10*x);
const back=(x,s=1.2)=>1+(s+1)*Math.pow(x-1,3)+s*Math.pow(x-1,2);
const fpv=(x,y,s=1,col=C.ink,sw=2.2,sx=1,sy=1,rot=0,op=1)=>`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s*sx} ${s*sy})" opacity="${op}"><circle r="7" fill="none" stroke="${col}" stroke-width="${sw}"/><path d="M-7 0H-18M7 0H18M0-7V-13" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/></g>`;
const star=(x,y,r,col)=>`<path transform="translate(${x} ${y})" d="M0 ${-r} L${r*.22} ${-r*.22} L${r} 0 L${r*.22} ${r*.22} L0 ${r} L${-r*.22} ${r*.22} L${-r} 0 L${-r*.22} ${-r*.22}Z" fill="${col}"/>`;
const mono=(x,y,s,txt,col,anc="start",wt=400)=>`<text x="${x}" y="${y}" text-anchor="${anc}" font-family="B612M" font-weight="${wt}" font-size="${s}" fill="${col}">${txt}</text>`;
const lbl=(no,line,col)=>`<div class="no" style="color:${col}">Nº ${no}${line?`<br>${line}`:""}</div>`;
// a title that rises out of a mask once its tile has opened
const ttl=(txt,u,style="")=>`<h3 style="${style};clip-path:inset(-10px -10px -10px -10px)"><span style="display:inline-block;transform:translateY(${(1-eo(u))*110}%);opacity:${u>0?1:0}">${txt}</span></h3>`;

/* ---------- 1 Route: the flight plan as the ND draws it ---------- */
function tRoute(o){ const p=o.route, xs=[18,72,126,192,252,316], y=64, ax=18+p*(316-18), eta=["VIDP","0352Z","0410Z","0448Z","0521Z","VABB"], act=xs.findIndex(x=>x>ax);
  return `<div class="t wide" style="background:${C.gold};color:${C.ink}">${lbl("01","VIDP · VABB",C.ink)}
  <svg width="334" height="84" style="position:absolute;left:12px;top:6px"><line x1="6" y1="${y}" x2="330" y2="${y}" stroke="${C.ink}" stroke-width="2"/>
  ${xs.map((x,k)=>star(x,y,k===act?9:6.5,k===act?W:C.ink)+mono(x,y-14,8,eta[k],C.ink,"middle")).join("")}
  <path transform="translate(${ax} ${y})" d="M9 0 L-6 -6 L-6 6Z" fill="none" stroke="${C.ink}" stroke-width="1.8"/></svg>
  ${ttl("Route",o.ti[0],"right:12px;left:auto;bottom:auto;top:8px;font-size:28px")}</div>`; }

/* ---------- 2 N1: both engines on the upper EIS, from the photo: TAT, thrust mode, reference in green, digital boxes, redline ---------- */
function dial(cx,cy,r,v,ref){ const A=p=>p*2.25*Math.PI/180, P=(p,rr)=>[cx+rr*Math.cos(A(p)),cy+rr*Math.sin(A(p))];
  const arc=(a,b,rr)=>{ const [x2,y2]=P(b,rr); return `A${rr} ${rr} 0 ${(b-a)*2.25>180?1:0} 1 ${x2} ${y2}` };
  const [s0,s1]=P(0,r-1),[e0,e1]=P(0,r),[nx,ny]=P(v,r+3);
  let g=`<path d="M${cx} ${cy} L${s0} ${s1} ${arc(0,Math.max(v,.01),r-1)} Z" fill="#5d6577"/><path d="M${e0} ${e1} ${arc(0,104,r)}" fill="none" stroke="${K.wht}" stroke-width="2"/>`;
  for(let p=0;p<=100;p+=10){ const [a,b]=P(p,r),[c,d]=P(p,r-(p%20?4:7)); g+=`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${K.wht}" stroke-width="1.5"/>`; if(p%20===0){ const [tx,ty]=P(p,r-14); g+=mono(tx,ty+3.5,9,p/10,K.wht,"middle") } }
  const [r1,r2]=P(104,r+2),[r3,r4]=P(104,r-8), [bx,by]=P(ref,r+5);
  g+=`<line x1="${r1}" y1="${r2}" x2="${r3}" y2="${r4}" stroke="${K.red}" stroke-width="3"/><path transform="translate(${bx} ${by}) rotate(${ref*2.25+90})" d="M-4 -3 L0 3 L4 -3" fill="none" stroke="${K.grn}" stroke-width="2"/>`;
  g+=`<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${K.wht}" stroke-width="2.6" stroke-linecap="round"/>`;
  g+=mono(cx+r+6,cy-r-12,11,ref.toFixed(1),K.grn,"end",700)+`<rect x="${cx+r-44}" y="${cy-r-8}" width="50" height="20" fill="${K.blk}" stroke="${K.wht}" stroke-width="1.3"/>`+mono(cx+r+2,cy-r+7,15,v.toFixed(1),K.wht,"end",700);
  return g; }
function tN1(o){ const v1=o.n1, v2=Math.max(22,o.n1-.4*Math.sin(o.n1/20));
  return `<div class="t wide" style="background:${C.ink};color:${W}">${lbl("02","",W)}
  <svg width="358" height="150" style="position:absolute;left:0;top:0">${mono(12,46,9,"TAT",K.cyn)}${mono(36,46,9,"+28c",K.wht)}${mono(12,60,10,o.n1>60?"TO":"",K.grn,"start",700)}
   ${dial(166,96,38,v1,97.6)}${dial(290,96,38,v2,97.6)}${mono(228,128,10,"N1",K.cyn,"middle",700)}</svg>
  ${ttl(`N<sub style="font-size:.5em">1</sub>`,o.ti[1],"font-size:30px")}</div>`; }

/* ---------- 3 Gear: 737 main gear after the reference. The leg swings inboard about the trunnion while the side brace folds at its knee;
   three gear lights go green, red in transit, then out. Wheels: tread band with grooves, sidewall, alloy rim, tie bolts, brake-cooling slots, hubcap. ---------- */
function wheel3(x,y,front){ const d=9, rx=21, ry=29, id=front?"f":"r";
  let w=`<path d="M${x-d} ${y-ry} L${x} ${y-ry} L${x} ${y+ry} L${x-d} ${y+ry}Z" fill="#0d1015"/><ellipse cx="${x-d}" cy="${y}" rx="${rx}" ry="${ry}" fill="#090b0f"/>`;
  w+=[.25,.5,.75].map(f=>`<path d="M${x-d*f} ${y-ry} A${rx} ${ry} 0 0 0 ${x-d*f} ${y+ry}" fill="none" stroke="#252a33" stroke-width="1.1"/>`).join("");
  w+=`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#pti_tyre${id})"/><ellipse cx="${x}" cy="${y}" rx="${rx*.84}" ry="${ry*.84}" fill="none" stroke="#2c323c" stroke-width=".8"/>`;
  if(!front) return w+`<ellipse cx="${x}" cy="${y}" rx="12.5" ry="17.5" fill="#5b6370"/><ellipse cx="${x}" cy="${y}" rx="4.4" ry="6" fill="#3d444f"/>`;
  w+=`<ellipse cx="${x}" cy="${y}" rx="12.5" ry="17.5" fill="url(#pti_rim)"/><ellipse cx="${x}" cy="${y}" rx="11" ry="15.5" fill="none" stroke="#7d8696" stroke-width="1"/>`;
  for(let k=0;k<6;k++){ const a=k/6*Math.PI*2+.3; w+=`<ellipse cx="${x+7.6*Math.cos(a)*.72}" cy="${y+7.6*Math.sin(a)}" rx="1.5" ry="2.6" fill="#30363f" transform="rotate(${a*180/Math.PI+90} ${x+7.6*Math.cos(a)*.72} ${y+7.6*Math.sin(a)})"/>` }
  for(let k=0;k<12;k++){ const a=k/12*Math.PI*2; w+=`<circle cx="${x+5.6*Math.cos(a)*.72}" cy="${y+5.6*Math.sin(a)}" r=".9" fill="#59616e"/>` }
  w+=`<ellipse cx="${x}" cy="${y}" rx="3.4" ry="4.6" fill="url(#pti_rim)" stroke="#8b94a3" stroke-width=".6"/><circle cx="${x}" cy="${y}" r="1" fill="#59616e"/>`;
  w+=`<path d="M${x-9} ${y-11} A12.5 17.5 0 0 1 ${x+3} ${y-17}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>`;
  return w; }
function tGear(o){ const c=o.gear, rt=eio(cl(o.retract)), pl=34-c*20, A=96+pl+8, ang=-84*rt, rad=ang*Math.PI/180;
  const rot=([x,y])=>[x*Math.cos(rad)-(y-11)*Math.sin(rad), x*Math.sin(rad)+(y-11)*Math.cos(rad)+11];
  // side brace: the upper end is fixed to the airframe, the lower end rides on the strut; the knee is found from the two link lengths
  const F=[54,6], Pa=rot([8,70]), L1=Math.hypot(54-46,6-38), L2=Math.hypot(46-8,38-70), dx=Pa[0]-F[0], dy=Pa[1]-F[1], dd=Math.hypot(dx,dy);
  const a=(L1*L1-L2*L2+dd*dd)/(2*dd), h=Math.sqrt(Math.max(0,L1*L1-a*a)), mx=F[0]+a*dx/dd, my=F[1]+a*dy/dd, Kn=[mx-h*dy/dd, my+h*dx/dd];
  const lit=o.retract<=0?K.grn: o.retract<1?K.red:"#2a3446", lt=o.retract<1?"#0b0f16":"#56637a";
  const lamps=["L","N","R"].map((n,k)=>`<rect x="${97+k*24}" y="10" width="20" height="13" rx="2" fill="${lit}"/>${mono(107+k*24,20,8,n,lt,"middle",700)}`).join("");
  return `<div class="t" style="background:${C.navy};color:${W}">${lbl("03","",W)}
  <svg width="179" height="190" style="position:absolute;left:0;top:0;overflow:hidden">${lamps}<defs><linearGradient id="pti_stg" x1="0" x2="1"><stop offset="0" stop-color="#c9d0da"/><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#aab3c1"/></linearGradient>
   <linearGradient id="pti_chg" x1="0" x2="1"><stop offset="0" stop-color="#8d97a8"/><stop offset=".3" stop-color="#f4f7fb"/><stop offset=".6" stop-color="#b4bdcb"/><stop offset="1" stop-color="#7f899a"/></linearGradient>
   <radialGradient id="pti_tyref" cx=".42" cy=".4" r=".62"><stop offset="0" stop-color="#2b313b"/><stop offset=".75" stop-color="#171b22"/><stop offset="1" stop-color="#0c0e12"/></radialGradient>
   <radialGradient id="pti_tyrer" cx=".42" cy=".4" r=".62"><stop offset="0" stop-color="#1c2028"/><stop offset="1" stop-color="#090b0f"/></radialGradient>
   <radialGradient id="pti_rim" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#d3d9e1"/><stop offset="1" stop-color="#99a2b0"/></radialGradient></defs>
   <g transform="translate(58 36) scale(.66)">
   <rect x="-60" y="-2" width="132" height="5" rx="2" fill="#2c4a7a"/>
   <path d="M${F[0]} ${F[1]} L${Kn[0]} ${Kn[1]} L${Pa[0]} ${Pa[1]}" fill="none" stroke="#b7bfcc" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
   <circle cx="${F[0]}" cy="${F[1]}" r="4" fill="${W}"/><circle cx="${Kn[0]}" cy="${Kn[1]}" r="3.6" fill="${W}"/>
   <g transform="rotate(${ang} 0 11)">
    ${wheel3(-22,A,false)}
    <path d="M-12 2 h24 l-3 14 h-18z" fill="url(#pti_stg)"/><rect x="-18" y="4" width="8" height="6" rx="3" fill="#aab3c1"/><rect x="10" y="4" width="8" height="6" rx="3" fill="#aab3c1"/>
    <rect x="-9" y="12" width="18" height="84" rx="4" fill="url(#pti_stg)"/><rect x="-12" y="88" width="24" height="10" rx="3" fill="url(#pti_stg)"/><circle cx="8" cy="70" r="3" fill="${W}"/>
    <rect x="-6" y="98" width="12" height="${pl}" fill="url(#pti_chg)"/>
    <path d="M-4 18 C -6 50, -5 80, -10 ${A-20}" fill="none" stroke="#2d3a2f" stroke-width="1.6"/><path d="M-1 18 C -3 50, -2 82, -6 ${A-22}" fill="none" stroke="#1d232c" stroke-width="1.2"/>
    <path d="M-11 94 L${-21+c*6} ${98+pl/2} L-11 ${A-8}" fill="none" stroke="#e4e8ee" stroke-width="3.4" stroke-linejoin="round"/><circle cx="${-21+c*6}" cy="${98+pl/2}" r="2.6" fill="${C.gold}"/>
    <rect x="-28" y="${A-4}" width="56" height="8" rx="3" fill="#7f899a"/><rect x="-8" y="${A-9}" width="16" height="18" rx="3" fill="#5b6370"/>
    ${wheel3(24,A,true)}<circle class="gearpt" cx="0" cy="12" r=".5" fill="none"/></g></g></svg>
  ${ttl("Gear",o.ti[2],"left:auto;right:12px")}</div>`; }

/* ---------- 4 Climb: the vertical profile with the FL100 / 250 kt restriction and top of climb ---------- */
function tClimb(o){ const p=o.climb;
  return `<div class="t" style="background:${C.stone};color:${C.ink}">${lbl("04","",C.ink)}
  <svg width="179" height="190" style="position:absolute;left:0;top:0">
   <line x1="14" y1="50" x2="168" y2="50" stroke="${C.dgold}" stroke-dasharray="3 3"/>${mono(166,44,8,"FL370",C.dgold,"end")}
   <line x1="14" y1="100" x2="96" y2="100" stroke="${C.ink}" stroke-opacity=".35" stroke-dasharray="2 3"/>${mono(16,95,7.5,"FL100 · 250KT",C.ink)}
   <path d="M14 132 C 48 132, 50 100, 76 100 C 104 100, 108 54, 158 50" fill="none" stroke="${C.ink}" stroke-width="3" stroke-dasharray="240" stroke-dashoffset="${240*(1-p)}"/>
   <rect x="6" y="134" width="34" height="4" fill="${C.ink}"/>
   <g opacity="${seg(p,.85,1)}"><circle cx="142" cy="51" r="5" fill="none" stroke="${C.ink}" stroke-width="1.6"/>${mono(142,68,7.5,"T/C",C.ink,"middle")}</g></svg>
  ${ttl("Climb",o.ti[3])}</div>`; }

/* ---------- 5 Stabilised: the runway ahead with approach lights, the rabbit, PAPI; beside it the PFD ---------- */
function drum(x,y,w,h,big,cols,frac,sz,id,bw,col=K.wht){ return `<clipPath id="pti_${id}"><rect x="${x+1}" y="${y+1}" width="${w-2}" height="${h-2}"/></clipPath><g clip-path="url(#pti_${id})" font-family="B612M" font-weight="700" fill="${col}"><text x="${x+w-bw}" y="${y+h/2+sz*.36}" text-anchor="end" font-size="${sz}">${big}</text>
   ${[-1,0,1].map(d=>`<text x="${x+w-3}" y="${y+h/2+sz*.32-d*h+frac*h}" text-anchor="end" font-size="${sz*.82}">${cols(d)}</text>`).join("")}</g>`; }
function runway(o){ const cx=74, vy=34, Y=z=>vy+192/(z), Xs=(z,s)=>cx+s*230/z;   // z: distance, 1 = nearest
  let r=""; const zT=1.6, zE=6;   // threshold and far end
  r+=`<path d="M${Xs(zT,-.42)} ${Y(zT)} L${Xs(zE,-.42)} ${Y(zE)} L${Xs(zE,.42)} ${Y(zE)} L${Xs(zT,.42)} ${Y(zT)}Z" fill="#30363f" stroke="${W}" stroke-opacity=".6" stroke-width=".8"/>`;
  for(let k=-4;k<=4;k++){ if(!k) continue; const s=k*.085; r+=`<path d="M${Xs(zT*1.02,s-.025)} ${Y(zT*1.02)} L${Xs(zT*1.22,s-.022)} ${Y(zT*1.22)} L${Xs(zT*1.22,s+.022)} ${Y(zT*1.22)} L${Xs(zT*1.02,s+.025)} ${Y(zT*1.02)}Z" fill="${W}"/>` }
  r+=`<text x="${cx}" y="${Y(zT*1.38)+3}" text-anchor="middle" font-family="B612M" font-weight="700" font-size="9" fill="${W}" transform="translate(${cx} ${Y(zT*1.38)}) scale(1 .7) translate(${-cx} ${-Y(zT*1.38)})">27</text>`;
  for(let z=zT*1.6;z<zE;z*=1.18) r+=`<line x1="${cx}" y1="${Y(z)}" x2="${cx}" y2="${Y(z*1.07)}" stroke="${W}" stroke-width="${1.6/z*2.2}"/>`;
  const zA=zT*1.9; r+=[-1,1].map(s=>`<path d="M${Xs(zA,s*.14)} ${Y(zA)} L${Xs(zA*1.14,s*.14)} ${Y(zA*1.14)} L${Xs(zA*1.14,s*.26)} ${Y(zA*1.14)} L${Xs(zA,s*.26)} ${Y(zA)}Z" fill="${W}"/>`).join("");
  r+=[-1,1].map(s=>`<line x1="${Xs(zT,s*.46)}" y1="${Y(zT)}" x2="${Xs(zT,s*.2)}" y2="${Y(zT)}" stroke="${K.grn}" stroke-width="2.2"/>`).join("");
  // approach lights: centreline barrettes every 30 m, the crossbar at 300 m, the sequenced flashers running to the threshold twice a second
  const zs=[]; for(let z=zT*.96; z>1.06; z*=.93) zs.push(z);
  zs.forEach((z,i)=>{ const y=Y(z), sc=2.2/z; r+=[-2,-1,0,1,2].map(d=>`<circle cx="${Xs(z,d*.022)}" cy="${y}" r="${.6+sc*.55}" fill="#fff6dc" opacity=".85"/>`).join("");
    if(i===zs.length-4) r+=[-6,-5,-4,-3,3,4,5,6].map(d=>`<circle cx="${Xs(z,d*.022)}" cy="${y}" r="${.6+sc*.55}" fill="#fff6dc" opacity=".85"/>`).join("") });
  const n=zs.length, ph=o.app; zs.slice().reverse().forEach((z,i)=>{ const on=Math.max(0,1-Math.abs(ph*n-i)/.9); if(on>0){ const y=Y(z)-.6; r+=`<circle cx="${cx}" cy="${y}" r="${Math.min(4,(1+on*2)*1.8/z+.6)}" fill="#fff" opacity="${on}"/><circle cx="${cx}" cy="${y}" r="${Math.min(8,7*on*2/z)}" fill="#cfe6ff" opacity="${.35*on}"/>` } });
  // PAPI, left of the runway abeam the aiming point: two white, two red = on the path
  const zP=zA*1.05; ["#ffffff","#ffffff",K.red,K.red].forEach((c,k)=>{ const x=Xs(zP,-.62)+k*5.2*2.2/zP*1.2, y=Y(zP); r+=`<circle cx="${x}" cy="${y}" r="1.9" fill="${c}"/><circle cx="${x}" cy="${y}" r="4.6" fill="${c}" opacity=".2"/>` });
  r+=fpv(cx,Y(zA)-6,.8,W,2)+`<circle class="aimpt" cx="${cx}" cy="${Y(zA)}" r=".5" fill="none"/>`;
  return r; }
function pfd(o){ const spd=o.spd, alt=o.alt, X=146, cy=146, sp=3.2, ap=.36, trend=o.trend||0, F=o.fma, tk=o.phase==="to";
  // FMA: engaged modes in green, armed modes in white beneath, a green box round a mode that has just changed
  const fx0=X+38, fw=104/3; let g=`<rect x="${fx0}" y="4" width="104" height="26" fill="#3b3f46"/>`;
  F.cols.forEach((c,k)=>{ const x=fx0+fw*(k+.5); g+=mono(x,16,6.6,c[0],K.grn,"middle")+(c[1]?mono(x,26,6,c[1],K.wht,"middle"):""); if(c[2]) g+=`<rect x="${fx0+fw*k+2}" y="7" width="${fw-4}" height="12" fill="none" stroke="${K.grn}" stroke-width="1"/>` });
  g+=[1,2].map(k=>`<line x1="${fx0+fw*k}" y1="5" x2="${fx0+fw*k}" y2="29" stroke="${K.wht}"/>`).join("");
  // speed tape with flap 30 mark, selected speed and its bug in magenta, the trend vector
  const sx=X+2, sw=32; g+=`<rect x="${sx}" y="48" width="${sw}" height="196" fill="${K.tape}"/>`;
  for(let v=45;v<=200;v+=5){ const y=cy-(v-spd)*sp; if(y<50||y>242) continue; g+=`<line x1="${sx+sw-7}" y1="${y}" x2="${sx+sw}" y2="${y}" stroke="${K.wht}" stroke-width="1.2"/>`+(v%20===0?mono(sx+sw-9,y+3.5,9.5,v,K.wht,"end"):"") }
  const sel=tk?149:146, by=cy-(sel-spd)*sp; g+=`<path d="M${sx+sw} ${by-6} h7 v12 h-7 l-3 -6z" fill="none" stroke="${K.mag}" stroke-width="1.8"/>`;
  const refs=tk?[[140,"V1"],[143,"VR"]]:[[141,"30"]]; refs.forEach(([v,l])=>{ const fy=cy-(v-spd)*sp; if(fy>50&&fy<242) g+=`<line x1="${sx+sw-12}" y1="${fy}" x2="${sx+sw}" y2="${fy}" stroke="${K.grn}" stroke-width="1.5"/>`+mono(sx+sw+3,fy+3,7,l,K.grn) });
  if(Math.abs(trend)>.5) g+=`<path d="M${sx+sw+2} ${cy} V${cy-trend*sp}" stroke="${K.grn}" stroke-width="1.6"/><path d="M${sx+sw-1} ${cy-trend*sp+(trend>0?4:-4)} L${sx+sw+2} ${cy-trend*sp} L${sx+sw+5} ${cy-trend*sp+(trend>0?4:-4)}" fill="none" stroke="${K.grn}" stroke-width="1.6"/>`;
  g+=mono(sx+sw/2+4,42,11,String(sel),K.mag,"middle",700);
  g+=`<path d="M${sx-6} ${cy-11} h34 l6 11 l-6 11 h-34z" fill="${K.blk}" stroke="${K.wht}" stroke-width="1.3"/>`+drum(sx-6,cy-11,34,22,String(Math.floor(spd/10)),d=>((Math.floor(spd)%10)+d+10)%10,spd%1,13,"rs",10);
  g+=mono(sx-4,262,9,"GS",K.wht)+mono(sx+12,262,11,Math.max(0,Math.round(spd-6)),K.wht,"start",700);
  // attitude: sky, ground, pitch ladder, roll scale, aircraft symbol, flight directors (magenta), FPV, deviation scales
  const ax=X+38, aw=104, acx=ax+aw/2, ppd=4, pitch=o.pitch, fpa=o.fpa, hy=cy+pitch*ppd, top=48, ah=180;
  g+=`<clipPath id="pti_ac"><rect x="${ax}" y="${top}" width="${aw}" height="${ah}" rx="14"/></clipPath><g clip-path="url(#pti_ac)"><rect x="${ax}" y="0" width="${aw}" height="${hy}" fill="${K.sky}"/><rect x="${ax}" y="${hy}" width="${aw}" height="300" fill="${K.gnd}"/><line x1="${ax}" y1="${hy}" x2="${ax+aw}" y2="${hy}" stroke="${K.wht}" stroke-width="1.5"/>`;
  for(let p=-20;p<=20;p+=2.5){ if(!p) continue; const y=hy-p*ppd, w=p%10===0?20:p%5===0?11:5; g+=`<line x1="${acx-w}" y1="${y}" x2="${acx+w}" y2="${y}" stroke="${K.wht}" stroke-width="1.1"/>`+(p%10===0?mono(acx-w-3,y+3,7,Math.abs(p),K.wht,"end")+mono(acx+w+3,y+3,7,Math.abs(p),K.wht):"") }
  g+=`</g>`;
  const rr=54, rcy=cy; [-60,-45,-30,-20,-10,10,20,30,45,60].forEach(a=>{ const q=(a-90)*Math.PI/180, l=Math.abs(a)%30===0?8:5; g+=`<line x1="${acx+rr*Math.cos(q)}" y1="${rcy+rr*Math.sin(q)}" x2="${acx+(rr+l)*Math.cos(q)}" y2="${rcy+(rr+l)*Math.sin(q)}" stroke="${K.wht}" stroke-width="1.2"/>` });
  g+=`<path d="M${acx} ${rcy-rr} l-5 -8 h10z" fill="none" stroke="${K.wht}" stroke-width="1.2"/><path d="M${acx} ${rcy-rr+1} l-5 8 h10z" fill="${K.wht}"/>`;
  g+=mono(acx,top-6,11,"FD",K.grn,"middle",700);
  const fdx=o.fdx||0, fdy=o.fdy||0; g+=`<line x1="${acx-34}" y1="${cy+fdy}" x2="${acx+34}" y2="${cy+fdy}" stroke="${K.mag}" stroke-width="2.6"/><line x1="${acx+fdx}" y1="${cy-40}" x2="${acx+fdx}" y2="${cy+40}" stroke="${K.mag}" stroke-width="2.6"/>`;
  g+=`<path d="M${acx-44} ${cy-2.5} h24 v12 h-6 v-7 h-18z M${acx+44} ${cy-2.5} h-24 v12 h6 v-7 h18z" fill="${K.blk}" stroke="${K.wht}" stroke-width="1.2"/><rect x="${acx-3}" y="${cy-3}" width="6" height="6" fill="${K.blk}" stroke="${K.wht}" stroke-width="1.1"/>`;
  const fy2=cy+(pitch-fpa)*ppd; g+=(o.nofpv?"":fpv(acx,fy2,.85,K.wht,2.1))+`<circle class="fpvpt" cx="${acx}" cy="${fy2}" r=".5" fill="none"/>`;
  if(!tk) g+=mono(ax+5,top+13,7,"ISCZ/270°",K.wht);
  if(!tk){ [-2,-1,1,2].forEach(d=>{ g+=`<circle cx="${ax+aw+9}" cy="${cy+d*16}" r="2.4" fill="none" stroke="${K.wht}" stroke-width="1.1"/><circle cx="${acx+d*18}" cy="${top+ah+9}" r="2.4" fill="none" stroke="${K.wht}" stroke-width="1.1"/>` });
  g+=`<line x1="${ax+aw+4}" y1="${cy}" x2="${ax+aw+14}" y2="${cy}" stroke="${K.amb}" stroke-width="1.6"/><path d="M${ax+aw+9} ${cy-6+(o.gs||0)} l5 6 l-5 6 l-5 -6z M${acx+(o.loc||0)} ${top+ah+3} l6 6 l-6 6 l-6 -6z" fill="${K.mag}"/>`; }
  // altitude tape: selected altitude and baro in their colours, rolling 20 ft drum, V/S scale and needle
  const tx=ax+aw+18, tw=36; g+=`<rect x="${tx}" y="48" width="${tw}" height="196" fill="${K.tape}"/>`;
  for(let v=0;v<=4000;v+=20){ const y=cy-(v-alt)*ap; if(y<50||y>242) continue; g+=`<line x1="${tx}" y1="${y}" x2="${tx+(v%100?4:8)}" y2="${y}" stroke="${K.wht}" stroke-width="1.1"/>`+(v%200===0?mono(tx+tw-2,y+3.5,9,v,K.wht,"end"):"") }
  g+=(tk?"":mono(tx+tw/2,42,11,"3800",K.mag,"middle",700))+mono(tx+tw/2,258,9,"1013 HPA",K.grn,"middle");
  g+=`<path d="M${tx-4} ${cy} l6 -11 h${tw+2} v22 h-${tw+2}z" fill="${K.blk}" stroke="${K.wht}" stroke-width="1.3"/>`+drum(tx+2,cy-11,tw+2,22,String(Math.floor(alt/100)),d=>String(((Math.floor(alt/20)*20)%100+d*20+100)%100).padStart(2,"0"),(alt%20)/20,12,"ra",15);
  const vx=tx+tw+4; g+=`<path d="M${vx} 70 h5 l7 30 v92 l-7 30 h-5z" fill="#3b3f46"/>`; const vs=o.vs||0, vyy=cy-cl(vs/2000,-1,1)*66; g+=`<line x1="${vx+4}" y1="${cy}" x2="${vx+14}" y2="${vyy}" stroke="${K.wht}" stroke-width="1.6"/>`;
  // heading arc
  g+=`<clipPath id="pti_hc"><rect x="${ax-10}" y="${top+ah+16}" width="${aw+20}" height="40"/></clipPath><g clip-path="url(#pti_hc)"><circle cx="${acx}" cy="${top+ah+76}" r="56" fill="#5d6168"/>`;
  for(let h=-40;h<=40;h+=5){ const q=(h-90)*Math.PI/180, l=h%10?4:7; g+=`<line x1="${acx+56*Math.cos(q)}" y1="${top+ah+76+56*Math.sin(q)}" x2="${acx+(56-l)*Math.cos(q)}" y2="${top+ah+76+(56-l)*Math.sin(q)}" stroke="${K.wht}" stroke-width="1.1"/>`+(h%10===0?`<text x="${acx+46*Math.cos(q)}" y="${top+ah+79+46*Math.sin(q)}" text-anchor="middle" font-family="B612M" font-size="7" fill="${K.wht}">${(27+h/10+36)%36}</text>`:"") }
  g+=`</g><path d="M${acx} ${top+ah+21} l-4 -6 h8z" fill="${K.wht}"/><path d="M${acx-5} ${top+ah+16} h10 v4 l-5 4 l-5 -4z" fill="none" stroke="${K.mag}" stroke-width="1.4"/>`;
  return g; }
function tStab(o){ return `<div class="t wide" style="background:${C.night};color:${W}">${lbl("05","RWY 27 · 1000 FT",W)}
  <svg class="pti-rw" width="358" height="272" style="position:absolute;left:0;top:0">${runway(o)}</svg><svg class="pti-pf" width="358" height="272" style="position:absolute;left:0;top:0">${pfd(o)}</svg>${ttl("Stabilised",o.ti[4],"font-size:26px")}</div>`; }

const ROWS=[92,150,190,272], BX=16, BY=70;
const tileRect=[[0,0,358,92],[0,92,358,150],[0,242,179,190],[179,242,179,190],[0,432,358,272]];
function boardTiles(o){ return [tRoute(o),tN1(o),tGear(o),tClimb(o),tStab(o)].map((h,k)=>{ const c=o.clip?o.clip[k]:null; return c?h.replace('style="',`style="clip-path:${c};`):h }) }


const D2=1.15, DUR=12.0+D2;   // D2: time the takeoff beat and slower spool added before the 3D part
const B=[{t:.45,x:150,y:502,tiles:[4]},{t:.75,x:262,y:312,tiles:[2,3]},{t:1.0,x:118,y:162,tiles:[0,1]}];
function heroPos(t){
  if(t<.45){ const u=t/.45; return [lerp(40,150,u), lerp(30,502,u*u)] }
  if(t<.75){ const u=(t-.45)/.3; return [lerp(150,262,u), lerp(502,312,u)-Math.sin(Math.PI*u)*130] }
  if(t<1.0){ const u=(t-.75)/.25; return [lerp(262,118,u), lerp(312,162,u)-Math.sin(Math.PI*u)*80] }
  return null;
}
// camera: [tx, ty, scale, rotateX, rotateZ] about the board's centre
const O=[179,352], focus=(L,S)=>[-S*(L[0]-O[0]),-S*(L[1]-O[1]),S,0,0];
const CAM={full:[0,0,1,0,0], pfdT:focus([244,570],1.85), n1:focus([228,167],1.55), gr:focus([96,337],2.0), cb:focus([268,337],2.0), pfd:focus([244,570],1.85), ap:focus([78,600],2.5), st:focus([92,590],1.75),
  tilt:[0,40,1.0,56,-12], orb:[-10,30,1.08,58,-22], gear:[6,30,1.62,58,-28], rise:[0,-10,.3,48,-16]};
// keyframes: [time, state, how]  how: "w" = whip pan (fast middle, roll, blur), otherwise smooth
const KF=[[0,"full"],[1.5,"full"],[1.75,"n1","w"],[2.35,"n1"],[2.6,"pfdT","w"],[3.1,"pfdT"],[3.35,"gr","w"],[3.85,"gr"],[4.1,"cb","w"],[4.45,"cb"],[4.7,"pfd","w"],[5.1,"pfd"],[5.35,"ap","w"],[5.7,"ap"],[5.95,"st","w"],[6.3,"st"],[6.65,"full"],
  [7.3,"tilt"],[7.95,"orb"],[8.65,"gear"],[9.15,"gear"],[9.95,"rise"],[99,"rise"]];
const push=(st,f)=>[st[0]*f,st[1]*f,st[2]*f,st[3],st[4]];
function cam(t){
  for(let i=0;i<KF.length-1;i++){ const [a,sa]=KF[i],[b,sb,how]=KF[i+1]; if(t<b){ const u=seg(t,a,b), w=how==="w";
    if(sa===sb) return push(CAM[sa],1+.035*u);   // a hold: slow push-in
    const from=(i>0&&KF[i-1][1]===sa)?push(CAM[sa],1.035):CAM[sa];
    const m=from.map((v,k)=>lerp(v,CAM[sb][k],w?e5(u):eio(u)));
    if(w) m[4]+=Math.sin(Math.PI*u)*2.4*(i%2?1:-1);
    return m } }
  return CAM.rise; }
const tf=c=>`translate(${c[0]}px,${c[1]}px) rotateX(${c[3]}deg) rotateZ(${c[4]}deg) scale(${c[2]})`;
const FE=["Duty","Block","Take-home","METAR · TAF","Globe","Roster","Layover","Night","Training","Sectors","Backup","Sunrise","Allowance","Tax","Year","Weather"];
const SHOTS=["month","log","pay","map","more"];
let WALL=""; { let k=0, m=0; for(let r=-2;r<=2;r++) for(let c=-2;c<=2;c++){ if(!r&&!c) continue; const pos=`position:absolute;left:${c*398}px;top:${r*744}px;width:358px;height:704px`;
  if((r+c+10)%2===0){ WALL+=`<div style="${pos};background:#f5f2ea url(intro/wall_${SHOTS[m%SHOTS.length]}.jpg) center/cover;border-radius:18px;box-shadow:0 30px 60px rgba(0,0,0,.35)"></div>`; m++ }
  else { const col=[C.navy,C.gold,"#1b2230",C.stone][(k+r+4)%4], dk=col===C.navy||col==="#1b2230";
    WALL+=`<div style="${pos};background:${col};color:${dk?W:C.ink};padding:26px;border-radius:18px"><div style="font:400 20px B612M;opacity:.7">Nº ${String(k+6).padStart(2,"0")}</div><div style="position:absolute;left:26px;bottom:30px;font:500 96px/1 News;letter-spacing:-.02em">${FE[k%FE.length]}</div></div>`; k++ } } }
const cc=PAL.cc;
const corners=()=>``;
const MK=[[250,50],[228,170],[268,330]];   // where the ring bounces in 3D (board coordinates)
STAGE.insertAdjacentHTML("beforeend",`<div id="pti-pg" class="page"></div><div id="pti-dk" style="position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 40%,#1c2433,#0b0f16);opacity:0"></div>
 <div id="pti-cor">${corners()}</div>
 <div id="pti-persp" style="position:absolute;inset:0;perspective:900px"><div id="pti-plane" style="position:absolute;left:${BX}px;top:${BY}px;width:358px;height:704px;transform-origin:179px 352px;transform-style:preserve-3d">
  <div id="pti-wall" style="position:absolute;inset:0;opacity:0">${WALL}</div><div id="pti-bd"></div>${MK.map((m,k)=>`<i id="pti-mk${k}" style="position:absolute;left:${m[0]}px;top:${m[1]}px;width:1px;height:1px"></i>`).join("")}</div></div>
 <div id="pti-dof" style="position:absolute;inset:0;pointer-events:none;opacity:0"><div style="position:absolute;left:0;right:0;top:0;height:42%;-webkit-backdrop-filter:blur(3.5px);backdrop-filter:blur(3.5px);-webkit-mask-image:linear-gradient(#000,transparent);mask-image:linear-gradient(#000,transparent)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:30%;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);-webkit-mask-image:linear-gradient(transparent,#000);mask-image:linear-gradient(transparent,#000)"></div></div>
 <svg id="pti-fx" width="390" height="844" style="position:absolute;inset:0;overflow:visible"><defs><linearGradient id="pti_ch" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c9d0db"/><stop offset="1" stop-color="#7d8696"/></linearGradient></defs><g id="pti-fxg"></g></svg>
 <div id="pti-tag" style="position:absolute;left:24px;top:90px;font:400 40px/1.1 News;color:${W};letter-spacing:-.01em;text-shadow:0 2px 20px rgba(0,0,0,.45)"><span>Every</span> <span>sector</span><br><span>counts.</span></div>
 <div id="pti-cards" style="position:absolute;inset:0;background:#0b0f16;opacity:0;perspective:800px"><div id="pti-cplane" style="position:absolute;inset:0;transform-style:preserve-3d"></div></div>
 <div id="pti-fin" class="page" style="opacity:0"></div><svg id="pti-fx2" width="390" height="844" style="position:absolute;inset:0;pointer-events:none"></svg>
 <div id="pti-blk" style="position:absolute;left:16px;bottom:${PB}px;font:700 9px/1 B612M;letter-spacing:.08em;background:#1b2230;color:#f3f0e8;padding:6px 8px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.18)"></div>
 <div id="pti-rte" style="position:absolute;right:16px;bottom:${PB}px;font:700 9px/1 B612M;letter-spacing:.08em;background:#1b2230;color:#f3f0e8;padding:6px 8px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.18)">VIDP → VABB</div>
 <div id="pti-vig" style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 90% at 50% 45%,transparent 60%,rgba(0,0,0,.35));opacity:0"></div>`);
const $=id=>STAGE.querySelector("#pti-"+id);
const CACHE=[];
function paintBoard(o){ const bd=$("bd"); if(!bd.firstChild) bd.innerHTML=`<div class="board" style="left:0;top:0;grid-template-rows:${ROWS.map(r=>r+"px").join(" ")}"></div>`;
  const brd=bd.firstChild, tl=boardTiles(o), tmp=document.createElement("div");
  tl.forEach((h,k)=>{ let key=h, parts=null;
    if(k===4){ parts=[runway(o),pfd(o)]; key=h.replace(parts[0],"").replace(parts[1],"") }
    const c=CACHE[k]||(CACHE[k]={});
    if(c.key!==key || !brd.children[k]){ tmp.innerHTML=h; const el=tmp.firstElementChild; if(brd.children[k]) brd.replaceChild(el,brd.children[k]); else brd.appendChild(el); c.key=key; c.parts=parts; return }
    if(parts){ const el=brd.children[k]; if(c.parts[0]!==parts[0]) el.querySelector(".pti-rw").innerHTML=parts[0]; if(c.parts[1]!==parts[1]) el.querySelector(".pti-pf").innerHTML=parts[1]; c.parts=parts } });
}
let WM={};
function measure(){ const sp=document.createElement("span"); sp.style.cssText="position:absolute;visibility:hidden;font:500 62px/1 News;letter-spacing:-.035em;white-space:nowrap"; document.body.appendChild(sp);
  sp.textContent="Pay Tr"; const w1=sp.getBoundingClientRect().width; sp.textContent="Pay Tracker"; const wT=sp.getBoundingClientRect().width; sp.remove(); const fw=30; WM={x0:195-(wT+fw)/2,w1,wT,fw,y:372} }
const LINE="B737 · block, duty and pay, to the minute.";
const ctr=el=>{ const r=el.getBoundingClientRect(); return [(r.left+r.width/2-OX)/SC, (r.top+r.height/2-OY)/SC] };
const pw=(t,pts)=>{ if(t<=pts[0][0]) return pts[0][1]; for(let i=0;i<pts.length-1;i++) if(t<pts[i+1][0]) return lerp(pts[i][1],pts[i+1][1],eio(seg(t,pts[i][0],pts[i+1][0]))); return pts[pts.length-1][1] };
const BLOCK=[[0,0],[1.5,0],[2.55,14],[3.05,15],[4.45,38],[4.7,110],[6.3,118],[8.65,123],[10.95,130]];   // minutes since chocks off
function state(t){
  const tL=t-D2;
  const clip=tileRect.map((r,k)=>{ const b=B.find(b=>b.tiles.includes(k)); const u=ex(seg(t,b.t,b.t+.55)); if(u>=1) return null; return `circle(${u*900}px at ${b.x-BX-r[0]}px ${b.y-BY-r[1]}px)` });
  const ti=[0,1,2,3,4].map(k=>{ const b=B.find(b=>b.tiles.includes(k)); return seg(t,b.t+.18,b.t+.6) });
  const o={clip,ti, route:pw(t,[[1.75,0],[2.55,0],[3.1,.03],[4.45,.2],[4.7,.82],[6.3,.95],[8.65,1]]),
    n1: t<1.8?22:lerp(22,97.6,back(seg(t,1.8,2.6),.45)), climb:eo(seg(t,4.15,4.6)), app:(t*2)%1, nofpv:t<1.32};
  if(t<4.45){   // takeoff at Delhi: THR HLD / TO/GA / TO/GA, roll through V1 and VR, rotate to the 15 degree flight director command, lift off
    const spd=t<2.5?45:lerp(125,156,seg(t,2.5,3.15)), pitch=15*eio(seg(t,2.78,3.12)), air=seg(t,2.95,3.15);
    Object.assign(o,{phase:"to", spd, alt:780+eo(air)*60, pitch, fpa:7*eio(air), trend:t>2.5&&t<3.15?6:0, vs:air*1800, fdx:0, fdy:-(15-pitch)*4,
      fma:{cols:[[t<2.5?"N1":"THR HLD","",false],["TO/GA","",false],["TO/GA","",false]]}});
  } else {     // approach into Mumbai, ILS 27: localiser then glideslope capture, with the mode-change boxes
    const pu=eio(seg(t,4.6,5.15)), loc=t>=4.77, gsc=t>=4.97;
    Object.assign(o,{phase:"app", spd:lerp(161,146,pu), alt:lerp(1520,1040,pu), pitch:2.5, fpa:-3, trend:-(1-pu)*pu*4*7, vs:lerp(-950,-760,pu),
      fdx:lerp(12,0,eo(seg(t,4.65,5.25))), fdy:lerp(-9,0,eo(seg(t,4.65,5.25))), gs:lerp(7,0,eo(seg(t,4.65,5.35))), loc:lerp(-10,0,eo(seg(t,4.65,5.35))),
      fma:{cols:[["MCP SPD","",false],loc?["VOR/LOC","",true]:["HDG SEL","VOR/LOC",false],gsc?["G/S","",true]:["VNAV PTH","G/S",false]]}});
  }
  // gear: loaded, extends at lift-off, swings inboard (lights red, then out), down and green again on the approach, loaded at touchdown
  o.gear = t<3.3 ? .6*(1-eo(seg(t,3.25,3.4))) : tL<7.5 ? 0 : tL<7.62 ? .85*eo(seg(tL,7.5,7.62)) : lerp(.85,.6,eo(seg(tL,7.62,8.0)));
  o.retract = t<3.4 ? 0 : t<5.15 ? seg(t,3.4,3.78) : 1-seg(t,5.15,5.6);
  o.block=pw(t,BLOCK);
  return o; }
function render(t){
  const o=state(t), tL=t-D2; const bm=Math.round(o.block); $("blk").textContent=`BLOCK ${Math.floor(bm/60)}:${String(bm%60).padStart(2,"0")}`; paintBoard(o);
  const c=cam(t), c0=cam(Math.max(0,t-1/60)); $("plane").style.transform=tf(c);
  const vel=Math.hypot(c[0]-c0[0],c[1]-c0[1])+Math.abs(c[2]-c0[2])*500+Math.abs(c[4]-c0[4])*12;
  $("plane").style.filter=`blur(${Math.min(2.4,vel*.06)+eo(seg(tL,8.35,8.85))*4.5}px)`;
  $("dk").style.opacity=eo(seg(tL,5.5,6.0)); ROOT.style.background=(tL>=5.75&&tL<9.8)?"#0b0f16":PAL.bg; $("cor").style.opacity=(1-seg(t,1.45,1.6))+seg(tL,10.1,10.5);
  $("dof").style.opacity=seg(tL,6.0,6.4)*(1-seg(tL,8.3,8.6)); $("vig").style.opacity=seg(tL,5.6,6.1)*(1-seg(tL,9.6,9.8));
  $("wall").style.opacity=eo(seg(tL,8.05,8.6));
  [...$("tag").children].forEach((sp,k)=>{ const u=eo(seg(tL,8.45+k*.14,8.8+k*.14)); sp.style.opacity=u*(1-seg(tL,9.05,9.2)); sp.style.display="inline-block"; sp.style.transform=`translateY(${(1-u)*14}px)` });
  let fx="";
  // 2D: the FPV bounces with weight: stretched along its path when fast, squashed for a moment on each contact, a little motion blur, a hollow trail
  if(t<1.32){
    const P=heroPos(t);
    if(P){ for(let k=6;k>=1;k--){ const q=heroPos(t-k*.04); if(q&&t-k*.04>=0) fx+=fpv(q[0],q[1],1.55,`rgba(${PAL.ghost},${.22-k*.028})`,1.3) }
      const q=heroPos(Math.max(0,t-1/60)), vx=(P[0]-q[0])*60, vy=(P[1]-q[1])*60, sp=Math.hypot(vx,vy), a=Math.atan2(vy,vx)*180/Math.PI;
      let st=1+Math.min(.42,sp/2600), sq=null; B.forEach(b=>{ const d=t-b.t; if(d>=0&&d<.07) sq=1-Math.sin(d/.07*Math.PI)*.32 });
      for(let k=3;k>=1;k--){ const r=heroPos(Math.max(0,t-k/120)); if(r) fx+=`<g opacity=".18">${fpv(r[0],r[1],1.9,PAL.ink,2.2)}</g>` }
      fx+= sq ? `<g transform="translate(${P[0]} ${P[1]}) scale(${2-sq} ${sq})">${fpv(0,0,1.9,PAL.ink,2.2)}</g>`
              : `<g transform="translate(${P[0]} ${P[1]}) rotate(${a}) scale(${st} ${1/st}) rotate(${-a})">${fpv(0,0,1.9,PAL.ink,2.2)}</g>`; }
    else { const tgt=$("bd").querySelector(".fpvpt"); const T=tgt?ctr(tgt):[259,616]; const u=eio(seg(t,1.0,1.32)), x=lerp(118,T[0],u), y=lerp(162,T[1],u)-Math.sin(Math.PI*u)*50;
      fx+=fpv(x,y,lerp(1.9,.85,u),u>.3?K.wht:PAL.ink,lerp(2.2,2.1,u)); }
    B.forEach(b=>{ const u=seg(t,b.t,b.t+.4); if(u>0&&u<1){ fx+=`<line x1="${b.x-eo(u)*140}" y1="${b.y}" x2="${b.x+eo(u)*140}" y2="${b.y}" stroke="${PAL.ink}" stroke-width="1.2" opacity="${1-u}"/><circle cx="${b.x}" cy="${b.y}" r="${eo(u)*70}" fill="none" stroke="${PAL.ink}" stroke-width="${1.5*(1-u)}" opacity="${1-u}"/>` } }); }
  // 3D: the polished ring hops across the instruments while the camera orbits, and lands on the gear
  if(tL>=5.9&&tL<8.3){
    const G=ctr($("bd").querySelector(".gearpt")), M=[0,1,2].map(k=>ctr($("mk"+k))), S=c[2];
    const pts=[[M[0][0],-80,5.9],[M[0][0],M[0][1],6.2],[M[1][0],M[1][1],6.55],[M[2][0],M[2][1],6.95],[G[0],G[1],7.5]], H=[0,120,110,170];
    let x,y,gy,sz=16*S,squ=null;
    if(tL>=7.5){ const u=seg(tL,7.62,8.3); x=G[0]+u*30; gy=G[1]; y=gy-sz*1.1-eo(u)*480; sz*=1-u*.3; if(tL<7.62) squ=1-Math.sin(seg(tL,7.5,7.62)*Math.PI)*.3 }
    else for(let i=0;i<pts.length-1;i++) if(tL<pts[i+1][2]){ const u=seg(tL,pts[i][2],pts[i+1][2]); x=lerp(pts[i][0],pts[i+1][0],u); gy=lerp(i?pts[i][1]:pts[1][1],pts[i+1][1],u);
        y=i?gy-Math.sin(Math.PI*u)*H[i]*S-sz*1.1:lerp(pts[0][1],pts[1][1],u*u)-sz*1.1; const d=tL-pts[i][2]; if(i&&d<.06) squ=1-Math.sin(d/.06*Math.PI)*.28; break }
    const hgt=gy-y; fx+=`<ellipse cx="${x}" cy="${gy}" rx="${sz*1.9*(1-cl(hgt/500)*.5)}" ry="${sz*.5*(1-cl(hgt/500)*.5)}" fill="rgba(0,0,0,${.45-cl(hgt/400)*.32})"/>`;
    const r=sz, sc=squ?`scale(${2-squ} ${squ})`:"";
    fx+=`<g transform="translate(${x} ${y}) ${sc}"><circle r="${r}" fill="none" stroke="url(#pti_ch)" stroke-width="${r*.42}"/><path d="M${-r} 0H${-r*2.6}M${r} 0H${r*2.6}M0 ${-r}V${-r*1.9}" stroke="url(#pti_ch)" stroke-width="${r*.42}" stroke-linecap="round"/><path d="M${-r*.7} ${-r*.75} a${r} ${r} 0 0 1 ${r*1.1} ${-r*.3}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="${r*.12}" stroke-linecap="round"/></g>`; }
  $("fxg").innerHTML=fx;
  // cards slam together into the name; a cream wipe opens from the name
  $("cards").style.opacity=seg(tL,9.0,9.15)*(1-seg(tL,9.8,9.81));
  if(tL>=8.95&&tL<9.82){ const u=eo(seg(tL,9.0,9.5)), f=eio(seg(tL,9.5,9.8)), {x0,w1,wT,y}=WM, top=y-52, h=78;
    const card=(x,yy,w,hh,bg,txt,al,dx,dy,rot)=>`<div style="position:absolute;left:${x}px;top:${yy}px;width:${w}px;height:${hh}px;background:${bg};transform:translate(${(1-u)*dx}px,${(1-u)*dy}px) rotate(${(1-u)*rot}deg);overflow:hidden;color:#1b2230;font:500 62px/1 News;letter-spacing:-.035em;white-space:nowrap;box-shadow:0 18px 40px rgba(0,0,0,${.35*(1-f)})">${txt?`<span style="position:absolute;top:${y-yy-48}px;${al}">${txt}</span>`:""}</div>`;
    $("cplane").style.transform=`rotateX(${18*(1-f)}deg) rotateZ(${-4*(1-f)}deg)`;
    $("cplane").innerHTML=`<div style="position:absolute;inset:-300px;background:${PAL.bg};clip-path:circle(${f*1100}px at ${195+300}px ${372+300}px)"></div>`+card(x0-36,top-70,wT+90,80,C.gold,"","",-180,-220,-14)+card(x0-26,top-8,w1+26,h+16,"#fbf9f4","Pay Tr","right:0",-240,60,-10)+card(x0+w1,top-14,wT-w1+52,h+16,"#f5f2ea","acker","left:0",260,-50,12)+card(x0-10,top+h+20,wT+20,44,C.navy,"","",100,300,8);
    $("cplane").children[1].style.opacity=1-f; $("cplane").children[4].style.opacity=1-f; if(DKM){ $("cplane").children[2].style.opacity=1-f; $("cplane").children[3].style.opacity=1-f } }
  const fo=tL>=9.8?1:0; $("fin").style.opacity=fo;
  if(fo){ const {x0,y}=WM, n=Math.round(cl((tL-10.05)/1.15)*LINE.length), cur=(tL<11.25||Math.floor(tL*2.4)%2===0)?`<span style="display:inline-block;width:7px;height:13px;background:#e8a33d;vertical-align:-2px;margin-left:2px"></span>`:"";
    $("fin").innerHTML=`<div style="position:absolute;left:${x0}px;top:${y-48}px;font:500 62px/1 News;letter-spacing:-.035em;color:${PAL.ink};white-space:nowrap">Pay Tracker</div>
     <div class="mono" style="position:absolute;left:0;right:0;top:${y+30}px;text-align:center;font-size:11px;color:${PAL.ink};opacity:.8">${LINE.slice(0,n)}${cur}</div>`; }
  let f2=""; if(tL>=9.35){ const {x0,wT,y}=WM, u=eo(seg(tL,9.35,9.95)), px=x0+wT+14, py=y+4; const d=tL-9.95; const sq=d>=0&&d<.08?1-Math.sin(d/.08*Math.PI)*.3:1;
    const x=lerp(360,px,u), yy=lerp(240,py,u)-Math.sin(Math.PI*u)*40; f2=`<g transform="translate(${x} ${yy}) scale(${2-sq} ${sq})">${fpv(0,0,lerp(1.6,.68,u),tL<9.55?W:PAL.ink,2.4)}</g>` }
  $("fx2").innerHTML=f2;
}

  /* ---------- play ---------- */
  let t0=0, raf=0, closing=false;
  function close(fast){ if(closing) return; closing=true; cancelAnimationFrame(raf); dispatchEvent(new Event("ptintro:closing"));   // the app hides its screen while the intro fades... ROOT.style.transition=`opacity ${fast?.28:.5}s ease`; ROOT.style.opacity="0";
    setTimeout(()=>{ ROOT.remove(); document.documentElement.classList.remove("pti-wait"); dispatchEvent(new Event("ptintro:done")) }, fast?300:520) }   // ...then plays its arrival in full view
  ROOT.addEventListener("pointerdown", ()=>close(true));
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden) close(true) });
  const tick=now=>{ const t=(now-t0)/1000; if(t>=DUR+.6){ close(false); return } render(Math.min(t,DUR)); raf=requestAnimationFrame(tick) };
  const fonts=Promise.all(["500 62px News","400 40px News","700 10px B612M","400 10px B612M"].map(f=>document.fonts.load(f).catch(()=>0)));
  Promise.race([fonts, new Promise(r=>setTimeout(r,900))]).then(()=>{ measure();
    if(RMQ){ render(DUR); setTimeout(()=>close(false),1400); return }
    requestAnimationFrame(now=>{ t0=now; tick(now) }) });
  window.PTIntro={render:t=>render(t), DUR, close};
})();
