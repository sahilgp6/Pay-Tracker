/* The map (lab). One full-screen 3D globe (MapLibre, OpenFreeMap tiles) with two views:
   Month: the month's routes with the 737s flying them; tap a plane, route or airport for the flights behind it.
   Briefing: the planned route, NOTAM areas with their levels and active times, airport weather, winds aloft, and a
   close-up of each airport with its runway, taxiway and navaid NOTAMs.
   Briefings build up by place: each new PDF replaces the NOTAMs and weather for the places it covers (FIR sections and
   airports, NIL ones included) and leaves the rest; NOTAMs drop off when they expire. Read on the phone and kept only in
   this phone's storage, never in backups. "Offline" saves the map along the route so it works with no signal.
   Map data: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors. Runways: OurAirports. */
import { parseBriefing, activeAt, wxCat, locKey, obsTime, textLimits } from "./briefparse.js?b=99";
import { RWY, ICAO } from "./rwydata.js?b=99";

const HOST = "https://tiles.openfreemap.org", PHOST = "ptc://tiles.openfreemap.org", STYLES = {light:HOST + "/styles/liberty", dark:HOST + "/styles/dark"};
const MCACHE = "pt-map-v1", BCACHE = "pt-brief-v1", BKEY = "./briefing.json", DLKEY = "pt.mapdl", PREFKEY = "pt.bmprefs";
const MAXTILES = 2900;           // OpenFreeMap's offline limit is 3,000 tiles per download
const COL = {tra:"#b45cff", dng:"#ff5a45", obs:"#f0a640", svy:"#9aa2b0", oth:"#6fa8dc"};
const KIND = {tra:"Restricted / military", dng:"Danger", obs:"Drones, obstacles, fireworks", svy:"Survey flights", oth:"Other"};
const CATC = {good:"#38b37a", marg:"#f0a640", poor:"#ff5a45"};
const CATN = {good:"Good", marg:"Marginal", poor:"Poor"};

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const $ = (r, s) => r.querySelector(s);
const nmPerDegLat = 60;
const hhmm = t => { const d = new Date(t); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + "Z" };
const dayLbl = t => new Date(t).toLocaleDateString("en-GB", {timeZone:"UTC", weekday:"short", day:"numeric", month:"short"});
const lvl = n => n.lo == null && n.hi == null ? "Levels in the text" : n.lo == null ? "Up to " + ftTxt(n.hi, n.hiT) : n.hi == null ? "From " + ftTxt(n.lo, n.loT) : ftTxt(n.lo, n.loT) + " to " + ftTxt(n.hi, n.hiT);
const ftTxt = (f, raw) => raw ? raw : f == null ? "?" : f === 0 ? "SFC" : f >= 99999 ? "UNL" : f >= 10000 ? "FL" + Math.round(f / 100) : f.toLocaleString("en-IN") + " ft";
const prefs = (() => { let p; try{ p = Object.assign({nt:true, wx:true, mine:false, wind:0, look:"auto"}, JSON.parse(localStorage.getItem(PREFKEY) || "{}")) }catch(e){ p = {nt:true, wx:true, mine:false, wind:0, look:"auto"} }
  if(!p.v73){ p.mine = false; p.v73 = 1 }   // build 73: every stored NOTAM stays on the map; "Only my route" is now opt-in
  return p })();
const savePrefs = () => { try{ localStorage.setItem(PREFKEY, JSON.stringify(prefs)) }catch(e){} };

/* ---------- map data cache ----------
   Tiles, fonts and sprites have versioned addresses, so a saved copy is used first. The style and the tile index
   change, so the network is tried first and the saved copy used when there is no signal. */
const isFresh = url => !/\.[a-z0-9]+$/i.test(new URL(url).pathname);
async function cget(url, fresh = isFresh(url)){
  let c = null; try{ c = await caches.open(MCACHE) }catch(e){}
  if(!fresh && c){ const hit = await c.match(url); if(hit) return hit }
  try{
    if(navigator.onLine === false) throw new Error("offline");
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), fresh ? 6000 : 20000);
    const r = await fetch(url, {signal:ctl.signal}); clearTimeout(tm);
    if(r.ok){ if(c) await c.put(url, r.clone()).catch(() => {}); return r }
    if(r.status === 204 || r.status === 404) return r;
    throw new Error("HTTP " + r.status);
  }catch(e){ if(c){ const hit = await c.match(url); if(hit) return hit } throw e }
}
const toP = t => t.split(HOST).join(PHOST);

let ml = null;
async function loadLib(){
  if(ml) return ml;
  if(!document.getElementById("mlcss")){ const l = document.createElement("link"); l.id = "mlcss"; l.rel = "stylesheet"; l.href = new URL("./vendor/maplibre/maplibre-gl.css", import.meta.url).href; document.head.appendChild(l) }
  ml = await import("./vendor/maplibre/maplibre-gl.mjs");
  ml.addProtocol("ptc", async p => {
    const url = "https://" + p.url.slice(6), r = await cget(url);
    if(r.status === 204 || r.status === 404) return {data: p.type === "json" ? {} : new ArrayBuffer(0)};
    if(p.type === "json") return {data: JSON.parse(toP(await r.text()))};
    if(p.type === "string") return {data: await r.text()};
    return {data: await r.arrayBuffer()};
  });
  return ml;
}

/* ---------- briefing storage by place: this phone only, outside backups ---------- */
const SKEY = "./store.json";
const emptyStore = () => ({v:3, flights:[], locs:{}, wx:{}, aup:null});
async function putStore(S){ try{ const c = await caches.open(BCACHE); await c.put(SKEY, new Response(JSON.stringify(S), {headers:{"Content-Type":"application/json"}})) }catch(e){} }
// a NOTAM goes when its end time passes (permanent ones stay until a briefing for that place drops them); airspace tables at the end of their day
function prune(S, now = Date.now()){ let n0 = 0, n1 = 0;
  for(const k in S.locs){ const L = S.locs[k].notams; n0 += L.length; S.locs[k].notams = L.filter(n => n.to == null || n.to > now); n1 += S.locs[k].notams.length }
  if(S.aup && S.aup.date && now > S.aup.date + 864e5){ S.aup = null; n1-- }
  // flight plans: kept until two days after their day
  if(S.flights){ const k = S.flights.length; S.flights = S.flights.filter(f => !f.date || now < f.date + 3 * 864e5); if(S.flights.length !== k) n1-- }
  return n0 !== n1 }
async function loadStore(){
  try{ const c = await caches.open(BCACHE); const r = await c.match(SKEY); let S = r ? await r.json() : null;
    if(!S){ const old = await c.match(BKEY); if(old){ S = mergeBrief(emptyStore(), await old.json()); await c.delete(BKEY); await putStore(S) } }   // build 65 kept one briefing
    if(S && !S.flights){ S.flights = S.last ? [Object.assign({key:`${S.last.date}|${S.last.dep}|${S.last.dest}`}, S.last)] : []; delete S.last }   // before build 75: one plan
    if(S) prune(S); return S }catch(e){ return null } }
function mergeBrief(S, nb){
  const groups = {}; (nb.sects || []).forEach(k => groups[k] = []);
  for(const n of nb.notams){ if(n.kind === "aup") continue; const k = locKey(n); (groups[k] = groups[k] || []).push(n) }
  const kept = Object.keys(S.locs).filter(k => !(k in groups)).length;
  for(const k in groups) S.locs[k] = {date:nb.date, notams:groups[k]};
  for(const k in nb.wx) S.wx[k] = Object.assign({}, nb.wx[k], {date:nb.date});
  if(nb.aup && nb.aup.length) S.aup = {date:nb.date, rows:nb.aup};
  // each flight plan is kept by sector (day, from, to); uploading the same sector again replaces it, other sectors stay
  S.added = null;
  if(nb.route.length || nb.dep){ const f = {key:`${nb.date}|${nb.dep}|${nb.dest}`, date:nb.date, dep:nb.dep, dest:nb.dest, altn:nb.altn, route:nb.route, fl:nb.fl, winds:nb.winds, std:nb.std, sta:nb.sta, taxi:nb.taxi};
    S.flights = (S.flights || []).filter(x => x.key !== f.key); S.flights.push(f); S.flights.sort((a, b) => (a.std || a.date || 0) - (b.std || b.date || 0)); S.added = f.key }
  S.updated = Object.keys(groups).length; S.kept = kept; return S }
function viewOf(S){
  if(!S) return null; const F = S.flights || [], L = F[F.length - 1] || {}, seen = new Set(), notams = [];
  for(const k in S.locs) for(const n of S.locs[k].notams){ if(seen.has(n.id)) continue; seen.add(n.id); n.locDate = S.locs[k].date; if(n.lo == null || n.hi == null) textLimits(n); notams.push(n) }   // briefings read before build 74 get their text limits too
  if(!notams.length && !F.length && !Object.keys(S.wx).length) return null;
  return {date:L.date || null, dep:L.dep || null, dest:L.dest || null, altn:L.altn || [], route:L.route || [], fl:L.fl || null, winds:L.winds || {},
    notams, wx:S.wx, aup:S.aup ? S.aup.rows : [], places:Object.keys(S.locs).length, flights:F, key:L.key || null} }
async function dropBrief(){ try{ await caches.delete(BCACHE) }catch(e){} }

/* ---------- PDF to lines ---------- */
async function pdfLines(lib, buf, prog){
  const doc = await lib.getDocument({data:buf}).promise, out = [];
  for(let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p), tc = await page.getTextContent(), rows = [];
    for(const it of tc.items){ if(!("str" in it) || !it.str) continue; const x = it.transform[4], y = it.transform[5];
      let r = rows.find(r => Math.abs(r.y - y) < 2.2); if(!r){ r = {y, it:[]}; rows.push(r) } r.it.push({x, w:it.width || 0, s:it.str}) }
    rows.sort((a, b) => b.y - a.y);
    for(const r of rows){ r.it.sort((a, b) => a.x - b.x); let line = "", end = null;
      for(const it of r.it){ if(end != null && it.x - end > 1.2 && !/\s$/.test(line) && !/^\s/.test(it.s)) line += " "; line += it.s; end = it.x + it.w }
      out.push(line) }
    out.push(""); page.cleanup(); if(prog) prog(p / doc.numPages);
  }
  await doc.destroy(); return out;
}

/* ---------- geometry (nautical miles, flat over a few hundred miles) ---------- */
function circlePoly(c, rNm, n = 64){ const out = [], k = Math.cos(c[1] * Math.PI / 180);
  for(let i = 0; i <= n; i++){ const a = i / n * 2 * Math.PI; out.push([c[0] + Math.sin(a) * rNm / (60 * k), c[1] + Math.cos(a) * rNm / 60]) } return out }
function gcNm(a, b){ const r = Math.PI / 180, la1 = a[1] * r, la2 = b[1] * r, dl = (b[0] - a[0]) * r;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2)) }
function segDist(p, a, b, k){ // p,a,b lon/lat; returns NM
  const P = [(p[0]) * 60 * k, p[1] * 60], A = [a[0] * 60 * k, a[1] * 60], B = [b[0] * 60 * k, b[1] * 60];
  const dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy; let t = L ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy) }
function inPoly(p, poly){ let c = false; for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){ const a = poly[i], b = poly[j];
    if((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c } return c }
function shapeDist(p, sh){ const k = Math.cos(p[1] * Math.PI / 180);
  if(sh.t === "circle") return Math.max(0, gcNm(p, sh.c) - sh.r);
  if(sh.t === "pt") return gcNm(p, sh.c);
  if(sh.t === "poly" && inPoly(p, sh.p)) return 0;
  let d = 1e9; const P = sh.p; for(let i = 0; i < P.length - 1; i++) d = Math.min(d, segDist(p, P[i], P[i + 1], k)); return d }
function gcAt(A, B, f){ const r = Math.PI / 180, v = p => [Math.cos(p[1] * r) * Math.cos(p[0] * r), Math.cos(p[1] * r) * Math.sin(p[0] * r), Math.sin(p[1] * r)];
  const a = v(A), b = v(B), d = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])); if(d < 1e-9) return A.slice();
  const ka = Math.sin((1 - f) * d) / Math.sin(d), kb = Math.sin(f * d) / Math.sin(d), x = ka * a[0] + kb * b[0], y = ka * a[1] + kb * b[1], z = ka * a[2] + kb * b[2];
  return [Math.atan2(y, x) / r, Math.atan2(z, Math.hypot(x, y)) / r] }
const gcLine = (A, B, n = 48) => Array.from({length:n + 1}, (_, i) => gcAt(A, B, i / n));
function sampleRoute(pts, step = 5){ const out = []; let s = 0;
  for(let i = 0; i < pts.length - 1; i++){ const a = pts[i], b = pts[i + 1], L = gcNm(a, b), n = Math.max(1, Math.ceil(L / step));
    for(let j = 0; j < n; j++){ const f = j / n; out.push({p:[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], s:s + L * f}) } s += L }
  if(pts.length) out.push({p:pts[pts.length - 1], s}); return {pts:out, D:s} }

/* which NOTAMs touch this flight: near the route at the level you would be, or near the airports at any level */
function markMine(B, routePts, apts, keep){
  const {pts, D} = sampleRoute(routePts), cr = (B.fl || 350) * 100, climb = Math.min(130, D / 2.2), desc = Math.min(120, D / 2.2);
  const alt = s => s < climb ? cr * s / climb : s > D - desc ? cr * (D - s) / desc : cr;
  for(const n of B.notams){ if(!keep) n.mine = false; if(!n.shape || n.mine) continue;
    if(apts.some(a => shapeDist(a, n.shape) <= 25)){ n.mine = true; continue }
    const lo = n.lo == null ? 0 : n.lo, hi = n.hi == null ? 99999 : n.hi;
    n.mine = n.mine || pts.some(q => shapeDist(q.p, n.shape) <= 5 && lo <= alt(q.s) + 2000 && hi >= alt(q.s) - 2000) }
}

/* ---------- where a planned flight is at a time: off blocks at STD, airborne after the taxi time, along the route by each
   waypoint's elapsed time, on the ground at the destination until STA ---------- */
function flightAt(f, t){
  if(!f || !f.std || !f.route || f.route.length < 2) return null;
  const R = f.route, ct = R.map(p => p.ctm);
  for(let i = 1; i < ct.length; i++) if(ct[i] == null){ let j = i; while(j < ct.length && ct[j] == null) j++; const a = ct[i - 1] || 0, b = j < ct.length ? ct[j] : a; for(let k = i; k < j; k++) ct[k] = a + (b - a) * (k - i + 1) / (j - i + 1); i = j }
  const tko = f.std + (f.taxi || 0) * 6e4, land = tko + ct[ct.length - 1] * 6e4, onb = Math.max(f.sta || 0, land + 5 * 6e4);
  if(t < f.std || t > onb) return null;
  const first = [R[0].lon, R[0].lat], lastP = [R[R.length - 1].lon, R[R.length - 1].lat];
  if(t < tko) return {pos:first, brg:brgOf(first, [R[1].lon, R[1].lat]), phase:"taxi out", ground:true};
  if(t >= land) return {pos:lastP, brg:brgOf([R[R.length - 2].lon, R[R.length - 2].lat], lastP), phase:"landed", ground:true};
  const m = (t - tko) / 6e4; let i = 0; while(i < ct.length - 2 && m > ct[i + 1]) i++;
  const k = ct[i + 1] > ct[i] ? (m - ct[i]) / (ct[i + 1] - ct[i]) : 0, a = [R[i].lon, R[i].lat], b = [R[i + 1].lon, R[i + 1].lat];
  const toc = R.findIndex(p => p.n === "TOC"), tod = R.findIndex(p => p.n === "TOD");
  const phase = toc >= 0 && i < toc ? "climbing" : tod >= 0 && i >= tod ? "descending" : f.fl ? "FL" + f.fl : "en route";
  return {pos:[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], brg:brgOf(a, b), phase, ground:false, over:k < .5 ? R[i].n : R[i + 1].n}
}
function brgOf(a, b){ const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return (Math.atan2(y, x) / r + 360) % 360 }
const secLbl = f => `${f.dep || "?"}–${f.dest || "?"}`;

/* ---------- tiles for the offline download ---------- */
const tx = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z) };
function tilesAround(set, p, rNm, z){ const dl = rNm / 60, dk = rNm / (60 * Math.cos(p[1] * Math.PI / 180)), n = 2 ** z;
  const x0 = tx(p[0] - dk, z), x1 = tx(p[0] + dk, z), y0 = ty(p[1] + dl, z), y1 = ty(p[1] - dl, z);
  for(let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) for(let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) set.add(z + "/" + x + "/" + y) }
function tilePlan(routePts, apts, opt){
  const set = new Set(), {pts} = sampleRoute(routePts, 8);
  for(let z = 3; z <= 6; z++) for(let x = tx(60, z); x <= tx(100, z); x++) for(let y = ty(38, z); y <= ty(0, z); y++) set.add(z + "/" + x + "/" + y);
  for(let z = 7; z <= opt.cz; z++) for(const q of pts) tilesAround(set, q.p, opt.cr, z);
  for(const a of apts){ for(let z = 7; z <= 10; z++) tilesAround(set, a, opt.cr, z); for(let z = 11; z <= 13; z++) tilesAround(set, a, opt.ar, z); tilesAround(set, a, opt.zr, 14) }
  return set }

/* split-flap letters, like a departure board: each character flips through a few others before it lands.
   Adapted from SplitFlapText in React Bits (github.com/DavidHDev/react-bits), (c) David Haz, MIT + Commons Clause;
   rewritten here in plain JS. The letters stay on their tiles; Reduce Motion sets them straight away. */
const FLAP_CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function flapIn(el, text, rm){ if(!el) return; text = text == null ? el.textContent : text;
  if(el._flapT) el._flapT.forEach(clearInterval); el._flapT = []; el._flap = text;
  el.classList.add("flap"); el.setAttribute("aria-label", text); el.textContent = "";
  [...text].forEach((c, i) => { const sp = document.createElement("span"); sp.setAttribute("aria-hidden", "true");
    const fin = c === " " ? "\u00a0" : c; if(c === " ") sp.className = "sp"; el.appendChild(sp);
    if(rm || !/[A-Z0-9]/i.test(c)){ sp.textContent = fin; return }
    let n = 4 + Math.round(i * .9); sp.textContent = FLAP_CH[Math.floor(Math.random() * FLAP_CH.length)];
    const t = setInterval(() => { sp.classList.remove("f"); void sp.offsetWidth; sp.classList.add("f");
      if(--n <= 0){ sp.textContent = fin; clearInterval(t); el._flapT = el._flapT.filter(x => x !== t) } else sp.textContent = FLAP_CH[Math.floor(Math.random() * FLAP_CH.length)] }, 65);
    el._flapT.push(t) }) }
const flapBusy = el => !!(el && el._flapT && el._flapT.length);
// soft edge: four stacked blurs, each masked a little further in, so the map fades into the blur instead of meeting a hard line.
// The idea comes from GradualBlur in React Bits (same author and licence), rewritten here.
const softEdge = dir => `<div class="bmblur ${dir}" aria-hidden="true">${[1.5, 3, 6, 12].map((b, i) => `<i style="--b:${b}px;--a:${i * 22}%;--z:${i * 22 + 34}%"></i>`).join("")}</div>`;

/* ======================================================================================================== */
export async function openBriefMap(ctx){
  const lib = await loadLib(), apx = ctx.apx, base = ctx.base || "BOM";
  const solo = ctx.view === "month" || ctx.view === "brief";   // opened as the Month map or the Briefing map: no switch between them
  const o = document.createElement("div"); o.className = "bm"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Map");
  o.innerHTML = `<div class="bmtop">${softEdge("top")}
      <div role="button" tabindex="0" class="wclose hz" data-bm="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
      <div class="bmt"><b class="bmtt">Map</b><span class="bmsub">Loading the map…</span></div>
      <div class="bmseg" role="tablist" aria-label="View"><div role="tab" tabindex="0" data-bm="vmonth">Month</div><div role="tab" tabindex="0" data-bm="vbrief">Briefing</div></div>
      <div role="button" tabindex="0" class="wclose hz bmfit" data-bm="fit" aria-label="Back to all routes"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></div>
      <label class="wclose bmup" aria-label="Upload briefing PDF"><input type="file" accept="application/pdf,.pdf" hidden><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></label>
    </div>
    <div class="bmmap"></div>
    <div class="bmpills"><span class="bmpill bmclock"></span><span class="bmpill bmcount"></span></div>
    <div role="button" tabindex="0" class="bmpill bmback" data-bm="route" hidden>← Route</div>
    <div role="button" tabindex="0" class="bmlook" data-bm="look"></div>
    <div class="bmsheet" aria-live="polite"><div class="bmgrab" data-bm="sheet"></div><div class="bmsc"></div></div>
    <div class="bmbar">${softEdge("bot")}
      <div class="bmmonth"></div>
      <div class="bmsecs" role="tablist" aria-label="Sectors"></div>
      <div class="bmtime"><input type="range" class="bmslide" aria-label="Time" step="1"><span class="bmtl"></span></div>
      <div class="bmchips">
        <div role="button" tabindex="0" class="bmchip" data-bm="nt">NOTAMs</div>
        <div role="button" tabindex="0" class="bmchip" data-bm="mine">Only my route</div>
        <div role="button" tabindex="0" class="bmchip" data-bm="wx">Weather</div>
        <div role="button" tabindex="0" class="bmchip" data-bm="wind">Winds</div>
        <div role="button" tabindex="0" class="bmchip" data-bm="list">List</div>
        <div role="button" tabindex="0" class="bmchip" data-bm="off">Offline</div>
      </div>
    </div>`;
  document.body.appendChild(o); document.documentElement.classList.add("sheet-open", "bm-open"); if(ctx.haptics) ctx.haptics(o);
  const sheet = $(o, ".bmsheet"), sc = $(o, ".bmsc"), slide = $(o, ".bmslide");
  let lastNt = [], lastRw = [], S = await loadStore(), B = viewOf(S), T = Date.now(), view = null, mMarkers = [], jets = null, map = null, markers = [], windM = [], aidM = [], styleOK = false, closed = false, routePts = [], apts = [], zoomAp = null;
  // Close works from the first moment, even while the map is still loading
  $(o, '[data-bm="close"]').addEventListener("click", e => { e.stopPropagation(); close() });

  /* ---------- style: OpenFreeMap light or dark, online or saved; the other look if only that is saved; plain coastlines if neither ---------- */
  const mq = matchMedia("(prefers-color-scheme: dark)"), raws = {};
  const wantLook = () => prefs.look === "dark" || (prefs.look === "auto" && mq.matches) ? "dark" : "light";
  async function getStyle(k){
    for(const kk of [k, k === "dark" ? "light" : "dark"]){
      try{ const raw = await (await cget(STYLES[kk], true)).text(); raws[kk] = raw; const st = JSON.parse(toP(raw)); st.projection = {type:"globe"}; return {style:st, kind:kk, ok:true} }catch(e){} }
    const g = await import("./globedata.js"), rings = s => s.split("|").map(r => r.trim().split(" ").map(p => p.split(",").map(Number))), dk = k === "dark";
    return {kind:k, ok:false, style:{version:8, projection:{type:"globe"}, sources:{coast:{type:"geojson", data:{type:"FeatureCollection", features:[g.WORLD, g.REGION].map(s => ({type:"Feature", properties:{}, geometry:{type:"MultiLineString", coordinates:rings(s)}}))}}},
      layers:[{id:"bg", type:"background", paint:{"background-color":dk ? "#0e1a2c" : "#dfe6ee"}}, {id:"coast", type:"line", source:"coast", paint:{"line-color":dk ? "#7d9cc4" : "#5b7593", "line-width":1}}]}} }
  let look = await getStyle(wantLook()); styleOK = look.ok;
  if(closed) return;
  const style = look.style;
  const c0 = apx.get(base) || {lon:73, lat:19};
  map = new lib.Map({container:$(o, ".bmmap"), style, center:[c0.lon, c0.lat], zoom:3.6, maxPitch:70, attributionControl:{compact:true}, fadeDuration:0});
  map.on("error", () => {}); o.dataset.look = look.kind;
  window.__bm = {map, range:() => range(), get look(){ return o.dataset.look }, get B(){ return B }, get S(){ return S }, get view(){ return view }, get route(){ return routePts }, get nt(){ return lastNt }, get rw(){ return lastRw }, get jets(){ return jets }};
  await new Promise(ok => { if(map.isStyleLoaded()) ok(); else map.once("style.load", ok) });
  if(closed) return;

  /* ---------- overlay layers (added again after a change of look) ---------- */
  const fc = f => ({type:"FeatureCollection", features:f || []});
  const ntF = ["==", ["geometry-type"], "Polygon"], ntL = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]], ntP = ["==", ["geometry-type"], "Point"];
  let hasOMT = false, BRIEF_LAYERS = [];
  const MONTH_LAYERS = ["bm-mrc", "bm-mrl", "bm-mrd"];
  let arcsOn = false;   // build 81: once the lifted arcs are drawn, the flat route lines become their shadow on the ground
  const SHADOW = "rgba(5,12,24,.38)";
  function addOverlays(){
  const dk = o.dataset.look === "dark";
  map.addSource("bm-nt", {type:"geojson", data:fc()}); map.addSource("bm-rt", {type:"geojson", data:fc()}); map.addSource("bm-rw", {type:"geojson", data:fc()});
  map.addLayer({id:"bm-ntf", type:"fill", source:"bm-nt", filter:ntF, paint:{"fill-color":["get", "c"], "fill-opacity":["case", ["get", "on"], .26, .06]}});
  map.addLayer({id:"bm-ntl", type:"line", source:"bm-nt", filter:ntL, paint:{"line-color":["get", "c"], "line-width":1.6, "line-opacity":["case", ["get", "on"], .95, .35]}});
  map.addLayer({id:"bm-ntp", type:"circle", source:"bm-nt", filter:ntP, paint:{"circle-color":["get", "c"], "circle-radius":6, "circle-opacity":["case", ["get", "on"], .9, .3], "circle-stroke-color":"#fff", "circle-stroke-width":1}});
  map.addLayer({id:"bm-rtc", type:"line", source:"bm-rt", filter:["get", "sel"], paint:{"line-color":dk ? "#000" : "#0b1626", "line-width":5, "line-opacity":dk ? .7 : .55}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rto", type:"line", source:"bm-rt", filter:["!", ["get", "sel"]], paint:{"line-color":"#f6f1e4", "line-width":1.8, "line-opacity":.45, "line-dasharray":[2, 1.5]}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-rtl", type:"line", source:"bm-rt", filter:["get", "sel"], paint:{"line-color":"#f6f1e4", "line-width":2.4}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rwf", type:"fill", source:"bm-rw", filter:ntF, paint:{"fill-color":"#ff5a45", "fill-opacity":["case", ["get", "on"], .55, .1]}});
  map.addLayer({id:"bm-rwx", type:"line", source:"bm-rw", filter:["==", ["geometry-type"], "LineString"], paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5], "line-opacity":["case", ["get", "on"], 1, .2]}});
  hasOMT = !!(map.getStyle().sources || {}).openmaptiles;
  if(hasOMT) map.addLayer({id:"bm-twy", type:"line", source:"openmaptiles", "source-layer":"aeroway", minzoom:11, filter:["==", 1, 0],
    paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 12, 2, 16, 9], "line-dasharray":[1.4, .8]}});

  map.addSource("bm-mr", {type:"geojson", data:fc()});
  map.addLayer({id:"bm-mrc", type:"line", source:"bm-mr", paint:{"line-color":"#0b1626", "line-width":5, "line-opacity":arcsOn ? 0 : .4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrl", type:"line", source:"bm-mr", filter:["!", ["get", "dh"]], paint:{"line-color":arcsOn ? SHADOW : "#e9b949", "line-width":arcsOn ? 2 : 2.4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrd", type:"line", source:"bm-mr", filter:["get", "dh"], paint:{"line-color":arcsOn ? SHADOW : "#e9b949", "line-width":2, "line-opacity":.7, "line-dasharray":[2, 1.6]}});
  BRIEF_LAYERS = ["bm-ntf", "bm-ntl", "bm-ntp", "bm-rtc", "bm-rto", "bm-rtl", "bm-rwf", "bm-rwx"].concat(hasOMT ? ["bm-twy"] : []);
  }
  addOverlays();
  const M = ctx.month && ctx.month.routes && ctx.month.routes.length ? ctx.month : null;

  /* ---------- month view: routes, airports, and the 737s flying them ---------- */
  function monthSetup(){
    mMarkers.forEach(m => m.remove()); mMarkers = []; if(!M){ map.getSource("bm-mr").setData(fc()); return }
    map.getSource("bm-mr").setData(fc(M.routes.map(r => ({type:"Feature", properties:{k:r.k, dh:!!r.dh}, geometry:{type:"LineString", coordinates:gcLine([r.A.lon, r.A.lat], [r.B.lon, r.B.lat])}}))));
    M.stations.forEach(st => { const e = document.createElement("div"); e.className = "bmst" + (st.home ? " home" : "") + (st.abroad ? " abroad" : "");
      e.setAttribute("role", "button"); e.tabIndex = 0; e.dataset.bmst = st.code; e.setAttribute("aria-label", st.code + (st.city ? ", " + st.city : ""));
      e.innerHTML = `<i></i>${st.home ? "<u></u>" : ""}<span>${esc(st.code)}</span>`;
      mMarkers.push(new lib.Marker({element:e, anchor:"left", offset:[-7, 0]}).setLngLat([st.lon, st.lat]).addTo(map)) });
  }
  function fitMonth(anim){ if(!M) return; const P = M.stations.map(s => [s.lon, s.lat]);
    const b = P.reduce((b, p) => [[Math.min(b[0][0], p[0]), Math.min(b[0][1], p[1])], [Math.max(b[1][0], p[0]), Math.max(b[1][1], p[1])]], [[180, 90], [-180, -90]]);
    const cam = map.cameraForBounds(b, {padding:{top:130, bottom:150, left:60, right:60}, maxZoom:7}); if(!cam) return; overviewZoom = cam.zoom;
    if(anim === "open" && !ctx.rm()){ map.jumpTo({center:[cam.center.lng + 40, cam.center.lat - 10], zoom:Math.max(1, cam.zoom - 2.2), pitch:0, bearing:0}); map.flyTo({center:cam.center, zoom:cam.zoom, duration:1100, essential:true}); return }
    map.easeTo({center:cam.center, zoom:cam.zoom, pitch:0, bearing:0, duration:anim && !ctx.rm() ? 1100 : 0}) }
  /* The 737s, with the old globe's rules (build 64) plus slowing down when selected:
     - each leg takes 21 to 60 s by distance (3x slower than the old globe, at my request); out, 1.8 s on the ground at the far end (hidden), back, 1.8 s at home; nose first
     - quadratic ease along each leg; a random start for each plane
     - grows out of the runway over the first 30% of the track on the climb, shrinks over the last 30% to nothing at touchdown
     - same size on screen at any zoom; deadheads as a see-through jet
     - tap a plane: it slows to about a third of its pace, the detailed 737 is swapped in, the camera flies in low behind it
       (about 21 degrees above the horizon) with a smoothed heading; one finger drags round it to look around (left and
       right turns, up and down raises or lowers the camera), two fingers pinch in and out, twist to turn and move together
       to pan; it stays followed, and its nose always points along its track; tap the jet to centre it again; its route line goes faint and the others fainter; the details bubble floats above it
     - tap an airport: the camera turns to it, routes through it stay bright and the rest dim, its bubble floats above it
     - tap empty map: let go, and pull back out to the overview distance where you are
     - airport tags never pile on each other; while following, tags near the jet fade out of its way
     - the view flies in on opening; the globe button goes back to all routes; Escape closes */
  const SLOW = .35, G = 1.8, EL = Math.atan2(.065, .17), FZ = 6.9;   // EL: camera height behind the jet; FZ: follow zoom
  let overviewZoom = 4;
  async function startJets(){
    if(!M || closed) return; if(jets){ jets.run(); return }
    let THREE, build737; try{ THREE = await import("./vendor/three/three.module.min.js"); ({build737} = await import("./jet737.js?b=99")) }catch(e){ return }
    if(closed) return;
    const cv = document.createElement("canvas"); cv.className = "bmjets"; map.getCanvasContainer().insertBefore(cv, map.getCanvas().nextSibling);
    let R; try{ R = new THREE.WebGLRenderer({canvas:cv, alpha:true, antialias:true}) }catch(e){ cv.remove(); return }
    R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4658, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-300, 400, 900); scene.add(sun);
    const ghost = j => { j.traverse(m => { if(m.isMesh){ m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = .55 } }); return j };
    const base = build737({detail:false}); let baseD = null;
    const planes = M.routes.map(r => { const T = new THREE.Group(), g = new THREE.Group(), j = base.clone(true); if(r.dh) ghost(j);
      j.rotation.x = Math.PI / 2; g.add(j); T.add(g); scene.add(T);   // T: on screen, tilted with the map; g: heading; j: the jet, nose up the screen
      const A = [r.A.lon, r.A.lat], B2 = [r.B.lon, r.B.lat], dur = Math.max(21, Math.min(60, gcNm(A, B2) / 3440.065 * 141))   /* 3x the old pace (build 71), so a jet is easy to catch */, cyc = dur * 2 + G * 2;
      return {r, T, g, j, A, B:B2, dur, cyc, tt:Math.random() * cyc, rate:1, vis:0, pos:A, from:r.a} });
    let raf = 0, running = false, F = null, foc = null, last = 0;
    const orb = {pitch:0, yaw:0, z:FZ, ox:0, oy:0};   // following: how far you have looked round (yaw degrees, pitch radians), the zoom you pinch to, and where you have panned the view to (px from the jet)
    const bub = document.createElement("div"); bub.className = "gbubble bmfol"; bub.hidden = true; $(o, ".bmmap").appendChild(bub);
    const bp = {x:0, y:0, sx:-1, sy:-1};
    let emph = {};   // which routes are bright: following one, or focused on an airport (mirrors lines())
    /* build 81: lifted arcs with contrails, and more for the selected jet.
       - each route rises off the map as an arc (screen-up, higher for longer routes, at most HMAX px); the flat route line below is its shadow
       - each jet rides its arc and leaves a fading trail behind it
       - selected jet: its soft shadow on the map below it, steady red and green nav lights with white strobes and a red beacon,
         its contrail sinking back towards the ground track, a strip with where it is on the sector and the fixed block, and the
         destination's weather */
    const HMAX = 120;
    // arcs, trails and the selected jet's shadow are drawn on the jets' own GPU canvas (no extra layer to composite):
    // one ribbon mesh rebuilt each frame from screen-space polylines, with a colour and alpha per vertex
    const RMAX = 9000, rpos = new Float32Array(RMAX * 3), rcol = new Float32Array(RMAX * 4), ridx = new Uint32Array(RMAX * 3), rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rpos, 3).setUsage(THREE.DynamicDrawUsage)); rg.setAttribute("color", new THREE.BufferAttribute(rcol, 4).setUsage(THREE.DynamicDrawUsage));
    rg.setIndex(new THREE.BufferAttribute(ridx, 1).setUsage(THREE.DynamicDrawUsage));
    const rib = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({vertexColors:true, transparent:true, depthTest:false, depthWrite:false, side:THREE.DoubleSide})); rib.renderOrder = -2; rib.frustumCulled = false; scene.add(rib);
    let nv = 0, ni = 0;
    const lin = hex => { const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace); return [c.r, c.g, c.b] }, LIN = {gold:lin("#e9b949"), trail:lin("#faecc8"), goldL:lin("#b98510"), trailL:lin("#9c6a12")};   // deeper on the light map, or they vanish   // vertex colours are linear: convert so the gold stays gold
    function ribbon(P, wOf, cOf){   // P: screen points, null breaks the line; wOf(i): width in px; cOf(i): [r,g,b,a] 0..1
      let i = 0; while(i < P.length){ while(i < P.length && !P[i]) i++; let j = i; while(j < P.length && P[j]) j++;
        if(j - i >= 2) for(let k = i; k < j; k++){ if(nv + 2 > RMAX) return; const a = P[Math.max(i, k - 1)], b = P[Math.min(j - 1, k + 1)], q = P[k];
          let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; const w = wOf(k) / 2, c = cOf(k);
          rpos.set([q[0] - ty * w, -(q[1] + tx * w), 0, q[0] + ty * w, -(q[1] - tx * w), 0], nv * 3); rcol.set([...c, ...c], nv * 4);
          if(k > i){ ridx.set([nv - 2, nv - 1, nv, nv - 1, nv + 1, nv], ni); ni += 6 } nv += 2 }
        i = j } }
    let shTex = null; { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "rgba(0,0,0,1)"); r.addColorStop(.55, "rgba(0,0,0,.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); shTex = new THREE.CanvasTexture(c) }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map:shTex, transparent:true, depthTest:false, depthWrite:false, opacity:.3, side:THREE.DoubleSide}));
    shadow.renderOrder = -3; shadow.visible = false; scene.add(shadow);
    // get the GPU ready for the lights, ribbons and shadow now, so tapping a jet does not stall while it prepares them
    setTimeout(() => { if(closed) return; try{ if(!baseD) baseD = build737({detail:true}); const warm = new THREE.Group(), dj = baseD.clone(true); warm.add(lights(), dj); warm.position.set(-9999, 9999, 0); scene.add(warm);
        shadow.visible = true; R.compile(scene, cam); R.render(scene, cam); scene.remove(warm); shadow.visible = false }catch(e){} }, 400);   // the detailed 737 too: it was a 2 s stall on the first tap
    planes.forEach(p => { p.gc = Array.from({length:49}, (_, i) => gcAt(p.A, p.B, i / 48)) });
    const liftOf = (p, u) => (p.H || 0) * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
    const routeF = p => emph.mode === "follow" ? (p.r.k === emph.key ? 1 : .45) : emph.mode === "stn" ? (p.r.k.includes(emph.key) ? 1 : .35) : 1;
    arcsOn = true; map.setPaintProperty("bm-mrl", "line-color", SHADOW); map.setPaintProperty("bm-mrd", "line-color", SHADOW); map.setPaintProperty("bm-mrl", "line-width", 2); map.setPaintProperty("bm-mrc", "line-opacity", 0);
    // the selected jet's strip: where it is on the sector, the fixed block, the destination's weather
    const strip = document.createElement("div"); strip.className = "bmstrip"; strip.hidden = true; strip.setAttribute("aria-live", "off");
    strip.innerHTML = `<div class="bmsr"><b class="a"></b><span class="trk"><i class="fill"></i><i class="dot"></i></span><b class="b"></b></div><div class="bmsl"><span class="go"></span><span class="wxc"></span></div>`;
    o.appendChild(strip); let stripKey = "";
    function paintStrip(p){ if(!p){ if(!strip.hidden){ strip.hidden = true; stripKey = "" } return }
      const from = p.dir > 0 ? p.r.a : p.r.b, to = p.dir > 0 ? p.r.b : p.r.a, u = Math.max(0, Math.min(1, p.uu || 0));
      const fx = M.fixed ? M.fixed(from, to) : null, left = fx != null ? Math.round(fx * (1 - u)) : null, w = M.wx ? M.wx(to) : null;
      const go = p.r.dh ? "Deadhead" + (fx != null ? ` · ${hm(fx)} block` : "") : left != null ? `${hm(left)} to go · ${hm(fx)} fixed block` : "";
      const wx = w ? `${to} ${w.temp}° ${w.label}` : "";
      const key = from + to + go + wx; if(strip.hidden) strip.hidden = false;
      if(key !== stripKey){ stripKey = key; strip._tw = 0; $(strip, ".a").textContent = from; $(strip, ".b").textContent = to; $(strip, ".go").textContent = go;
        const wc = $(strip, ".wxc"); wc.textContent = wx; wc.hidden = !wx }
      $(strip, ".fill").style.transform = `scaleX(${u.toFixed(4)})`; const tw = strip._tw || (strip._tw = $(strip, ".trk").clientWidth); $(strip, ".dot").style.transform = `translateX(${(u * tw).toFixed(1)}px)` }
    const hm = m => Math.floor(m / 60) + ":" + String(Math.round(m % 60)).padStart(2, "0");
    // nav lights for the detailed jet: steady red (left) and green (right) at the wingtips, white strobes double-flashing, a red beacon
    let glowTex = null;
    function lights(){ if(!glowTex){ const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.75)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(c) }
      const K = .034 / 39.5, S = st => (39.52 / 2 - st) * K, tipY = (-1.05 + 16.5 * Math.tan(6 * Math.PI / 180)) * K, grp = new THREE.Group(), L = {};
      const add = (name, col, x, y, z, sz) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:col, blending:THREE.AdditiveBlending, depthTest:false, depthWrite:false, transparent:true}));
        m.position.set(x, y, z); m.scale.setScalar(sz * K); m.renderOrder = 10; grp.add(m); L[name] = m; return m };
      add("red", 0xff3b30, 17.5 * K, tipY, S(23.5), 2.4); add("green", 0x32ff7e, -17.5 * K, tipY, S(23.5), 2.4);   // the nose points to +z, so the left wing is +x
      add("sl", 0xffffff, 17.6 * K, tipY, S(24.2), 4); add("sr", 0xffffff, -17.6 * K, tipY, S(24.2), 4); add("st", 0xffffff, 0, .9 * K, S(39.4), 3);
      add("bt", 0xff2a1a, 0, 2.15 * K, S(19), 2.6); add("bb", 0xff2a1a, 0, -2.15 * K, S(21), 2.6);
      grp.userData.L = L; return grp }
    function blink(now){ if(!F || !F.jd || !F.jd.userData.lights) return; const L = F.jd.userData.lights.userData.L, t = now / 1000, rm = ctx.rm();
      const s = t % 1.3, strobe = !rm && (s < .05 || (s > .14 && s < .19)), beacon = !rm && ((t + .45) % 1.1) < .13;
      L.sl.visible = L.sr.visible = L.st.visible = strobe; L.bt.visible = L.bb.visible = beacon || rm }
    const size = () => { const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight; R.setSize(W, H, false); cam.right = W; cam.bottom = -H; cam.updateProjectionMatrix() };
    size(); map.on("resize", size);
    const brgOf = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return (Math.atan2(y, x) / r + 360) % 360 };
    const wrap = d => ((d + 540) % 360) - 180, ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2, ramp = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) };
    const lerpK = (k, dt) => 1 - Math.pow(1 - k, dt * 60);   // a per-frame lerp at 60 fps, the same at any frame rate
    function showBub(kind, key, from){ bub.innerHTML = M.bubble(kind, key, from); bub.hidden = false; bub.dataset.kind = kind; bp.sx = -1; flapIn(bub.querySelector(".gbh b"), null, ctx.rm());
      if(!ctx.rm()){ bub.classList.remove("pop"); void bub.offsetWidth; bub.classList.add("pop") } }
    function lines(mode, key){   // route line brightness: normal, following one route, or focused on an airport
      const op = mode === "follow" ? ["case", ["==", ["get", "k"], key], .35, .15] : mode === "stn" ? ["case", ["in", key, ["get", "k"]], 1, .25] : null;
      map.setPaintProperty("bm-mrl", "line-opacity", op || 1); map.setPaintProperty("bm-mrd", "line-opacity", op || .7); map.setPaintProperty("bm-mrc", "line-opacity", arcsOn ? 0 : op ? ["*", .4, op] : .4); emph = {mode, key} }
    // build 84: how far you can actually see. With the map tilted, places far beyond the horizon are squeezed into a band near the top of
    // the screen and were drawn over the nearby map (Dibrugarh over Kalyan). Anything farther than the farthest ground point on screen is left out.
    function farLimit(cen, pitch){ if(pitch < .5) return 4800; const c = map.getContainer(), W = c.clientWidth; let d = 0;
      for(const xy of [[0, 0], [W / 2, 0], [W, 0]]){ let g; try{ g = map.unproject(xy) }catch(e){ return 4800 } if(!g || !isFinite(g.lng) || !isFinite(g.lat)) return 4800; d = Math.max(d, gcNm(cen, [g.lng, g.lat])) }
      return Math.min(4800, d * 1.15 + 5) }
    function drawArcs(cen, pitch, fpx, LIM){
      const W = map.getContainer().clientWidth, Hh = map.getContainer().clientHeight; nv = 0; ni = 0;
      // a point well off screen (or beyond the horizon when you look along it) breaks the line
      const onScr = q => isFinite(q.x) && isFinite(q.y) && q.x > -W && q.x < W * 2 && q.y > -Hh && q.y < Hh * 2;
      const dk = o.dataset.look === "dark", GOLD = dk ? LIN.gold : LIN.goldL, TRAIL = dk ? LIN.trail : LIN.trailL, AK = dk ? 1 : 1.7, TK = dk ? 1 : .8;
      for(const p of planes){   // the arcs
        const a0 = map.project(p.A), b0 = map.project(p.B), Lp = Math.hypot(b0.x - a0.x, b0.y - a0.y); p.H = isFinite(Lp) ? Math.min(HMAX, Lp * .22) : HMAX;
        const ar = []; for(let i = 0; i <= 48; i++){ const g = p.gc[i]; if(gcNm(cen, g) > LIM || (p.r.dh && i % 3 === 2)){ ar.push(null); continue }   // deadheads dashed
          const q = map.project(g); ar.push(onScr(q) ? [q.x, q.y - liftOf(p, i / 48)] : null) }
        const al = Math.min(1, .34 * AK * routeF(p) * (p.r.dh ? .7 : 1)); ribbon(ar, () => 1.8, () => [...GOLD, al]) }
      for(const p of planes){   // the trails: 20 steps back along the arc from the jet, fading; the selected jet's sinks towards its ground track and spreads
        if(!(p.vis > .01) || p.uu < 0) continue; const dir = p.dir, tc = p.tc, len = .3, N = 20, f = routeF(p) * (p.r.dh ? .5 : 1) * Math.min(1, p.vis * 1.5), me = p === F, Q = [];
        for(let k = 0; k <= N; k++){ const u = tc - dir * len * k / N; if(u < 0 || u > 1) break; const g = gcAt(p.A, p.B, u);
          if(gcNm(cen, g) > LIM){ Q.push(null); continue } const q = map.project(g); Q.push(onScr(q) ? [q.x, q.y - liftOf(p, u) * (me ? 1 - .55 * k / N : 1)] : null) }
        ribbon(Q, k => me ? 3 + k * .25 : 2.6 * (1 - k / 30), k => [...TRAIL, (me ? .45 : .85) * TK * (1 - k / N) * f]) }
      rg.setDrawRange(0, ni);   // upload only the part in use this frame
      for(const [at, n] of [[rg.attributes.position, nv * 3], [rg.attributes.color, nv * 4], [rg.index, ni]]){ at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(1, n)); at.needsUpdate = true }
      shadow.visible = false;
      if(F && F.vis > .01 && F.lift > 2 && F.gx != null){   // the selected jet's shadow on the map below it, fainter the higher it is
        const span = .0309 * fpx * F.vis, rx = span * .5, ry = rx * Math.max(.12, Math.cos(pitch)) * .4, t = map.project(F.tail), n = map.project(F.nose);
        shadow.visible = true; shadow.position.set(F.gx, -F.gy, 0); shadow.rotation.z = -(Math.atan2(n.y - t.y, n.x - t.x) + Math.PI / 2); shadow.scale.set(rx * 2, ry * 2, 1);
        shadow.material.opacity = .34 * (1 - .45 * Math.min(1, F.lift / HMAX)) * F.vis }
    }
    function frame(now){
      if(!running || closed) return; raf = requestAnimationFrame(frame);
      if(document.hidden){ last = now; return }
      const dt = Math.min(.05, last ? (now - last) / 1000 : 0); last = now;
      for(const p of planes){
        p.rate += ((p === F ? SLOW : 1) - p.rate) * Math.min(1, dt * 2.5);   // eases down to a third when selected, back up when let go
        p.tt = (p.tt + dt * p.rate) % p.cyc; const tt = ctx.rm() ? p.dur * .5 : p.tt;
        let t, dir, u = -1;
        if(tt < p.dur){ u = tt / p.dur; t = ease(u); dir = 1 } else if(tt < p.dur + G){ t = 1; dir = -1 } else if(tt < p.dur * 2 + G){ u = (tt - p.dur - G) / p.dur; t = 1 - ease(u); dir = -1 } else { t = 0; dir = 1 }
        p.vis = u < 0 ? 0 : Math.pow(ramp(Math.min(t, 1 - t) / .3), .8); p.uu = u; p.dir = dir; p.tc = t;
        const tc = Math.max(.0005, Math.min(.9995, t)), t0 = Math.max(0, tc - .004), t1 = Math.min(1, tc + .004);
        p.pos = gcAt(p.A, p.B, tc); p.tail = gcAt(p.A, p.B, dir > 0 ? t0 : t1); p.nose = gcAt(p.A, p.B, dir > 0 ? t1 : t0);
        const from = dir > 0 ? p.r.a : p.r.b; if(p === F && from !== p.from && !bub.hidden) showBub("route", p.r.k, from); p.from = from;
      }
      // follow: low behind the jet, heading smoothed so a turnaround swings round gently; drag and pinch move round it
      if(F){ const hd = brgOf(F.tail, F.nose); F.sb = F.sb == null ? hd : (F.sb + wrap(hd - F.sb) * lerpK(ctx.rm() ? 1 : .04, dt) + 360) % 360;
        const k = lerpK(ctx.rm() ? 1 : .08, dt), el = EL + orb.pitch; if(!F.cc){ const c = map.getCenter(); F.cc = [c.lng, c.lat] }
        F.cc = [F.cc[0] + wrap(F.pos[0] - F.cc[0]) * k, F.cc[1] + (F.pos[1] - F.cc[1]) * k];   // the camera's own smoothed track of the jet
        const want = {bearing:(F.sb + orb.yaw + 360) % 360, pitch:Math.max(0, Math.min(70, 90 - el * 180 / Math.PI)), zoom:orb.z};   // nose always along the track
        F.ly = (F.ly == null ? 0 : F.ly) + ((F.lift || 0) - (F.ly || 0)) * k;   // build 81: frame the jet up on its arc, not the ground below it (its shadow sits below):
        // the focal point (the ground under the jet) moves down the screen by the jet's height, through the camera's padding, which keeps the perspective right
        map.jumpTo({center:F.cc, zoom:map.getZoom() + (want.zoom - map.getZoom()) * k, pitch:map.getPitch() + (want.pitch - map.getPitch()) * k, bearing:map.getBearing() + wrap(want.bearing - map.getBearing()) * k,
          padding:{top:Math.round(F.ly * 2), bottom:0, left:0, right:0}});
        if(orb.ox || orb.oy){ const q = map.project(F.cc), c2 = map.unproject([q.x - orb.ox, q.y - orb.oy]); map.jumpTo({center:c2}) } }   // panned: the view rides along, offset as you left it
      const ctr = map.getCenter(), cen = [ctr.lng, ctr.lat], pitch = map.getPitch() * Math.PI / 180, z = map.getZoom();
      const px = 30 / .034, fpx = Math.max(px, 230 / .034 * Math.pow(2, orb.z - FZ));
      const LIM = farLimit(cen, pitch); drawArcs(cen, pitch, fpx, LIM);   // ~30 px at any zoom; the followed jet ~230 px up close, smaller as you pinch out
      for(const p of planes){
        if(p.vis <= .01 || gcNm(cen, p.pos) > LIM){ p.T.visible = false; p.sx = null; continue }   // on the ground, round the back of the globe, or beyond what you can see
        const a = map.project(p.pos), t = map.project(p.tail), n = map.project(p.nose); p.T.visible = true;
        const tcc = Math.max(.0005, Math.min(.9995, p.tc)), lh = liftOf(p, tcc); p.lift = lh; p.gx = a.x; p.gy = a.y;   // up its arc; gx/gy: the ground point below
        t.y -= liftOf(p, p.dir > 0 ? tcc - .004 : tcc + .004); n.y -= liftOf(p, p.dir > 0 ? tcc + .004 : tcc - .004); a.y -= lh;
        p.T.position.set(a.x, -a.y, 0); p.T.rotation.x = -pitch * .85 - .28;
        // heading: the followed jet turns by its track against the map's bearing, so neither the 3D tilt nor zooming or looking round can swing its nose.
        // The others follow the line their track makes on screen; the jet is then tilted back by T.rotation.x, which squashes its up-down by cos(tilt),
        // so that part is stretched first, or the tilt would count twice and the nose would swing off the route as the view turns
        const tcos = Math.max(.15, Math.cos(pitch * .85 + .28));
        p.g.rotation.z = p === F ? Math.PI - (brgOf(p.tail, p.nose) - map.getBearing()) * Math.PI / 180 : Math.atan2(-(n.y - t.y) / tcos, n.x - t.x) + Math.PI / 2;
        p.T.scale.setScalar((p === F ? fpx : px) * Math.max(p.vis, .001)); p.sx = a.x; p.sy = a.y;
      }
      blink(now); R.render(scene, cam); paintStrip(F && F.vis > .01 ? F : null);
      // airport tags: none on top of another; while following, those near the jet step out of its way
      const placed = []; const fx = F && F.sx != null ? [F.sx, F.sy] : null;
      for(const m of mMarkers){ const ll = m.getLngLat(), q = map.project(ll), e = m.getElement();
        const far = gcNm(cen, [ll.lng, ll.lat]) > LIM; if(e._far !== far){ e._far = far; e.classList.toggle("tagfar", far) } if(far) continue;
        const clash = placed.some(([x, y]) => Math.abs(x - q.x) < 34 && Math.abs(y - q.y) < 16); let op = clash ? 0 : 1;
        if(!clash) placed.push([q.x, q.y]); if(fx && Math.abs(q.x - fx[0]) < 80 && Math.abs(q.y - fx[1]) < 70) op = Math.min(op, .1);
        if(e._op !== op){ e._op = op; e.classList.toggle("tagoff", op === 0); e.classList.toggle("tagdim", op > 0 && op < .5) } }   // classes: MapLibre rewrites marker opacity itself
      // the bubble eases after its target and only moves for real changes, so it stays steady enough to tap
      if(!bub.hidden){ let q = null;
        if(F && F.sx != null) q = {x:F.sx, y:F.sy - 34}; else if(foc){ const s = map.project([foc.lon, foc.lat]); q = {x:s.x, y:s.y - 14} }
        if(q){ const W = map.getContainer().clientWidth; if(bp.sx < 0){ bp.x = q.x; bp.y = q.y } bp.x += (q.x - bp.x) * .2; bp.y += (q.y - 26 - bp.y) * .2;
          const bx = Math.round(Math.min(W - 150, Math.max(150, bp.x))), by = Math.round(Math.max(bub.offsetHeight + 70, bp.y));
          if(Math.abs(bx - bp.sx) > 1.5 || Math.abs(by - bp.sy) > 1.5){ bp.sx = bx; bp.sy = by; bub.style.transform = `translate(${bx}px,${by}px) translate(-50%,-100%)` } } }
    }
    function detail(p, on){
      if(on){ if(!baseD) baseD = build737({detail:true}); const d = baseD.clone(true); if(p.r.dh) ghost(d); d.rotation.x = Math.PI / 2;
        const lg = lights(); d.add(lg); d.userData.lights = lg; p.g.add(d); p.jd = d; p.j.visible = false }
      else if(p.jd){ p.g.remove(p.jd); p.jd = null; p.j.visible = true }
    }
    // while following, your fingers move the camera round the jet instead of the map:
    // one finger looks around it, two fingers pinch to zoom, twist to turn and move together to pan
    const handlers = ["dragPan", "dragRotate", "touchZoomRotate", "touchPitch", "scrollZoom", "doubleClickZoom", "keyboard"];
    const freeMap = on => handlers.forEach(h => { try{ on ? map[h].enable() : map[h].disable() }catch(e){} });
    const ptrs = new Map(); let st = null, pinch = null; const box = map.getCanvasContainer();
    box.addEventListener("pointerdown", e => { if(!F) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(ptrs.size === 1) st = {x:e.clientX, y:e.clientY, yaw:orb.yaw, pitch:orb.pitch, on:false};
      if(ptrs.size === 2){ const [p, q] = [...ptrs.values()]; pinch = {d:Math.hypot(p.x - q.x, p.y - q.y), z:orb.z, a:Math.atan2(q.y - p.y, q.x - p.x), yaw:orb.yaw, mx:(p.x + q.x) / 2, my:(p.y + q.y) / 2, ox:orb.ox, oy:orb.oy} } });
    box.addEventListener("pointermove", e => { if(!F || !ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(ptrs.size === 2 && pinch){ const [p, q] = [...ptrs.values()];
        orb.yaw = pinch.yaw - wrap((Math.atan2(q.y - p.y, q.x - p.x) - pinch.a) * 180 / Math.PI);   // twist
        orb.ox = pinch.ox + (p.x + q.x) / 2 - pinch.mx; orb.oy = pinch.oy + (p.y + q.y) / 2 - pinch.my;   // move together: pan
        zoomTo(pinch.z + Math.log2(Math.max(20, Math.hypot(p.x - q.x, p.y - q.y)) / pinch.d)); return }   // pinch: zoom
      if(ptrs.size === 1 && st){ const dx = e.clientX - st.x, dy = e.clientY - st.y; if(!st.on && Math.hypot(dx, dy) < 10) return; st.on = true;
        orb.yaw = st.yaw - dx * 360 / Math.max(300, box.clientWidth);   // look around: a swipe across the screen goes once all the way round the jet
        orb.pitch = Math.max(-.016, Math.min(1.1, st.pitch + dy * .005)) } });   // up and down: lower towards the horizon or higher above it
    const up = e => { ptrs.delete(e.pointerId); if(ptrs.size < 2) pinch = null; if(ptrs.size === 1){ const [p] = [...ptrs.values()]; st = {x:p.x, y:p.y, yaw:orb.yaw, pitch:orb.pitch, on:true} } };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", e => { if(!F) return; e.preventDefault(); zoomTo(orb.z - e.deltaY * .0017) }, {passive:false});
    // zooming while following: in to street level, out as far as you like; past the overview it lets go and the map is yours
    function zoomTo(z){ if(z < overviewZoom - .3){ const zz = Math.max(0, z); jets.release(false); ptrs.clear(); pinch = null; st = null; map.jumpTo({zoom:zz}); map.easeTo({pitch:0, bearing:0, duration:ctx.rm() ? 0 : 500}); return }
      orb.z = Math.min(10, z) }
    jets = {planes, el:cv,
      run(){ if(running) return; running = true; cv.hidden = false; last = 0; raf = requestAnimationFrame(frame) },
      stop(){ running = false; cancelAnimationFrame(raf); cv.hidden = true; strip.hidden = true; this.release(false) },
      hit(x, y){ let best = null, d = 44; for(const p of planes){ if(!p.T.visible || p.sx == null || p.vis < .3) continue; const q = Math.hypot(p.sx - x, p.sy - y); if(q < d){ d = q; best = p } } return best },
      follow(p){ if(F === p){ orb.ox = 0; orb.oy = 0; orb.yaw = 0; orb.pitch = 0; return }   // tap the followed jet: centre it again, behind it
        if(F) detail(F, false); foc = null; closeSheet(); F = p; F.sb = null; F.cc = null; F.ly = null; orb.pitch = 0; orb.yaw = 0; orb.z = FZ; orb.ox = 0; orb.oy = 0;
        detail(p, true); showBub("route", p.r.k, p.from); lines("follow", p.r.k); freeMap(false); o.classList.add("following"); if(ctx.haptics) ctx.haptics(bub) },
      focus(code){ const s = M.stations.find(x => x.code === code); if(!s) return; if(F){ detail(F, false); F = null; freeMap(true); map.setPadding({top:0, bottom:0, left:0, right:0}); paintStrip(null) }
        closeSheet(); foc = {lon:s.lon, lat:s.lat}; showBub("stn", code); lines("stn", code); o.classList.remove("following");
        map.easeTo({center:[s.lon, s.lat], zoom:Math.max(map.getZoom(), overviewZoom + .6), pitch:0, bearing:0, duration:ctx.rm() ? 0 : 1100}) },   // flies there once; then the map is yours
      release(flyOut){ mMarkers.forEach(m => { const e = m.getElement(); e._far = false; e.classList.remove("tagfar") }); const was = F || foc; if(F) detail(F, false); if(F) map.setPadding({top:0, bottom:0, left:0, right:0}); F = null; foc = null; bub.hidden = true; paintStrip(null); lines(); freeMap(true); o.classList.remove("following");
        mMarkers.forEach(m => { const e = m.getElement(); e._op = null; e.classList.remove("tagoff", "tagdim") });
        if(was && flyOut) map.easeTo({zoom:Math.min(map.getZoom(), overviewZoom), pitch:0, bearing:0, duration:ctx.rm() ? 0 : 700}) },
      get following(){ return F }, get drawn(){ return ni }, get focused(){ return foc }, get orb(){ return orb },
      kill(){ this.stop(); try{ rg.dispose(); rib.material.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); shTex.dispose(); if(glowTex) glowTex.dispose(); R.dispose(); R.forceContextLoss() }catch(e){}   // free the GPU context: Safari allows only a few at once
        cv.remove(); strip.remove(); bub.remove() } };
    // panning the map yourself while an airport is focused lets go of it
    // (an airport's bubble stays put over it while you move the map; tap empty map to close it)
    if(view === "month") jets.run();
  }
  function monthSheet(kind, key, dirFrom){ if(!M || !M.bubble) return; const h = M.bubble(kind, key, dirFrom); if(!h) return; if(jets) jets.release(false);
    openSheet("month", `<div class="bmbub">${h}</div>`); flapIn(sc.querySelector(".gbh b"), null, ctx.rm()) }

  function layersFor(v){ BRIEF_LAYERS.forEach(id => map.setLayoutProperty(id, "visibility", v === "brief" ? "visible" : "none"));
    MONTH_LAYERS.forEach(id => map.setLayoutProperty(id, "visibility", v === "month" ? "visible" : "none")) }

  /* ---------- light and dark ---------- */
  const LOOKS = {auto:"Auto: follows your phone", light:"Light map", dark:"Dark map"};
  const ICON = {auto:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" class="f"/></svg>',
    light:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
    dark:'<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" class="f"/></svg>'};
  function lookBtn(){ const b = $(o, ".bmlook"); b.innerHTML = ICON[prefs.look]; b.setAttribute("aria-label", "Map look: " + LOOKS[prefs.look]); b.title = LOOKS[prefs.look] }
  let lookBusy = false;
  async function applyLook(){
    lookBtn(); const k = wantLook(); if(k === o.dataset.look || lookBusy) return; lookBusy = true;
    const nl = await getStyle(k); lookBusy = false; if(closed) return;
    if(nl.kind === o.dataset.look){ if(!nl.ok || nl.kind !== k) toast(k === "dark" ? "The dark map is not saved on this phone yet" : "The light map is not saved on this phone yet"); return }
    look = nl; styleOK = styleOK || nl.ok; o.dataset.look = nl.kind;
    map.once("style.load", () => { addOverlays(); restore() });
    map.setStyle(nl.style, {diff:false});
  }
  // after a new style: put the routes, areas and closures back, as they were
  function restore(){
    map.getSource("bm-nt").setData(fc(lastNt)); map.getSource("bm-rw").setData(fc(lastRw));
    map.getSource("bm-rt").setData(fc(routePts.length > 1 ? [{type:"Feature", properties:{}, geometry:{type:"LineString", coordinates:routePts}}] : []));
    if(M) map.getSource("bm-mr").setData(fc(M.routes.map(r => ({type:"Feature", properties:{k:r.k, dh:!!r.dh}, geometry:{type:"LineString", coordinates:gcLine([r.A.lon, r.A.lat], [r.B.lon, r.B.lat])}}))));
    layersFor(view); if(view === "brief"){ vis(); adPaint() } }
  function toast(t){ let e = $(o, ".bmtoast"); if(!e){ e = document.createElement("div"); e.className = "bmtoast"; e.setAttribute("role", "status"); o.appendChild(e) }
    e.textContent = t; e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 2600) }
  const onScheme = () => { if(prefs.look === "auto") applyLook() };
  mq.addEventListener ? mq.addEventListener("change", onScheme) : mq.addListener(onScheme);

  /* ---------- switching views ---------- */
  function setView(v, anim){
    if(v === "month" && !M) v = "brief"; view = v; o.dataset.view = v;
    $(o, '[data-bm="vmonth"]').setAttribute("aria-selected", String(v === "month")); $(o, '[data-bm="vbrief"]').setAttribute("aria-selected", String(v === "brief"));
    $(o, '[data-bm="vmonth"]').classList.toggle("dis", !M);
    layersFor(v);
    closeSheet(); zoomAp = null; if(jets) jets.release(false);
    if(v === "month"){ if(plane) plane.getElement().hidden = true; $(o, ".bmtt").textContent = M.label; $(o, ".bmsub").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · tap a plane to follow it`;
      $(o, ".bmmonth").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · ${M.stations.length} airports · drag to spin, pinch to zoom`;
      $(o, ".bmcount").textContent = M.label; fitMonth(anim); startJets() }
    else { if(jets) jets.stop(); drawPlane(); $(o, ".bmtt").textContent = "Briefing map"; vis(); sub(); count(); if(B) fitRoute(anim === true); if(!B) openSheet("list", emptyHtml()) }
  }

  /* ---------- sectors: pick one; its route, waypoints and winds are shown, the others faint ---------- */
  let selKey = null, plane = null;
  function pick(key){ if(!B || !B.flights || !B.flights.length){ selKey = null; return }
    const f = B.flights.find(x => x.key === key) || B.flights.find(x => x.key === selKey) || B.flights[B.flights.length - 1]; selKey = f.key;
    Object.assign(B, {date:f.date, dep:f.dep, dest:f.dest, altn:f.altn || [], route:f.route || [], fl:f.fl, winds:f.winds || {}}) }
  function defaultKey(){ if(!B || !B.flights || !B.flights.length) return null; const now = Date.now();
    const on = B.flights.find(f => f.std && now >= f.std - 2 * 36e5 && now <= (f.sta || f.std + 36e5 * 3));   // the sector you are in, or about to fly
    const next = B.flights.find(f => f.std && f.std > now && f.std - now < 18 * 36e5);
    return (on || next || B.flights.find(f => f.key === B.key) || B.flights[B.flights.length - 1]).key }
  function secs(){ const el = $(o, ".bmsecs"), F = B && B.flights || []; el.hidden = F.length < 2; o.classList.toggle("hassecs", F.length > 1);
    el.innerHTML = F.map((f, i) => `<div role="tab" tabindex="0" class="bmsec${f.key === selKey ? " on" : ""}" data-bmsec="${esc(f.key)}" aria-selected="${f.key === selKey}"><b>${i + 1}</b> ${esc(secLbl(f))}${f.std ? ` <small>${hhmm(f.std)}</small>` : ""}</div>`).join("") }

  /* ---------- briefing to map ---------- */
  function setup(){
    markers.forEach(m => m.remove()); markers = []; zoomAp = null;
    if(!B){ routePts = []; apts = []; map.getSource("bm-rt").setData(fc()); windM.forEach(m => m.remove()); windM = []; return }
    if(B.flights && B.flights.length) pick(selKey || defaultKey());
    const ptsOf = f => f.route && f.route.length > 1 ? f.route.map(p => [p.lon, p.lat]) : [f.dep, f.dest].map(k => apx.get(k)).filter(Boolean).map(a => [a.lon, a.lat]);
    const aptsOf = f => [f.dep, f.dest, ...(f.altn || [])].map(k => apx.get(k)).filter(Boolean).map(a => [a.lon, a.lat]);
    const FL = B.flights && B.flights.length ? B.flights : [B];
    routePts = ptsOf(B); apts = aptsOf(B);
    // "my route" is the whole day: every sector's route and airports
    B.notams.forEach(n => n.mine = false); FL.forEach(f => markMine(Object.assign({}, B, {fl:f.fl}), ptsOf(f), aptsOf(f), true));
    map.getSource("bm-rt").setData(fc(FL.map(f => { const P = ptsOf(f); return P.length > 1 ? {type:"Feature", properties:{sel:!B.flights || !B.flights.length || f.key === selKey}, geometry:{type:"LineString", coordinates:P}} : null }).filter(Boolean)));
    secs();
    // waypoints
    B.route.slice(1, -1).forEach(p => { const e = document.createElement("div"); e.className = "bmwp"; e.innerHTML = `<i></i><span>${esc(p.n)}</span>`;
      markers.push(new lib.Marker({element:e, anchor:"left", offset:[-5, 0]}).setLngLat([p.lon, p.lat]).addTo(map)) });
    // airports: weather colour, tap for the close-up
    const adN = {}; B.notams.forEach(n => { if(n.ad) adN[n.ad] = (adN[n.ad] || 0) + 1 });
    const codes = [...new Set([B.dep, B.dest, ...(B.altn || []), ...Object.keys(B.wx), ...Object.keys(adN)].filter(Boolean))];   // every airport with weather or NOTAMs on record
    codes.forEach(k => { const a = apx.get(k); if(!a) return; const w = B.wx[k], m = w && (w.metar ? wxCat(w.metar) : w.taf ? wxCat(w.taf) : null), ob = w && obsTime(w.metar, w.date);
      const e = document.createElement("div"); e.className = "bmap" + ([B.dep, B.dest].includes(k) ? " main" : "") + (B.altn && B.altn.includes(k) ? " alt" : "") + (!ob || Date.now() - ob > 3 * 36e5 ? " stale" : "");
      e.setAttribute("role", "button"); e.tabIndex = 0; e.dataset.bmap = k; e.setAttribute("aria-label", k + " airport");
      e.innerHTML = `<i style="background:${m ? CATC[m.cat] : "#8a94a6"}"></i><span>${esc(k)}${adN[k] ? `<b class="bmnc">${adN[k]}</b>` : ""}</span>`;
      markers.push(new lib.Marker({element:e, anchor:"left", offset:[-7, 0]}).setLngLat([a.lon, a.lat]).addTo(map)) });
    winds(); paintTime(false); if(view === "brief") fitRoute(false);   // keeps the time you are on (switching sectors must not jump back to now)
  }
  function fitRoute(anim){ const P = routePts.concat(apts); if(!P.length) return;
    const b = P.reduce((b, p) => [[Math.min(b[0][0], p[0]), Math.min(b[0][1], p[1])], [Math.max(b[1][0], p[0]), Math.max(b[1][1], p[1])]], [[180, 90], [-180, -90]]);
    map.fitBounds(b, {padding:{top:110, bottom:230, left:50, right:50}, duration:anim && !ctx.rm() ? 900 : 0, pitch:0, bearing:0, maxZoom:8}) }

  function ntFeatures(){
    const out = []; if(!B) return out;
    for(const n of B.notams){ if(!n.shape) continue; const on = activeAt(n, T), p = {id:n.id, c:COL[n.kind] || COL.oth, on, mine:!!n.mine};
      const g = n.shape.t === "circle" ? {type:"Polygon", coordinates:[circlePoly(n.shape.c, n.shape.r)]} : n.shape.t === "poly" ? {type:"Polygon", coordinates:[n.shape.p]}
        : n.shape.t === "line" ? {type:"LineString", coordinates:n.shape.p} : {type:"Point", coordinates:n.shape.c};
      out.push({type:"Feature", properties:p, geometry:g}) }
    return out }
  function vis(){ if(view === "month") return; const show = prefs.nt ? "visible" : "none", f = prefs.mine ? ["==", ["get", "mine"], true] : true;
    for(const [id, g] of [["bm-ntf", ntF], ["bm-ntl", ntL], ["bm-ntp", ntP]]){ map.setLayoutProperty(id, "visibility", show); map.setFilter(id, f === true ? g : ["all", g, f]) }
    o.classList.toggle("nowx", !prefs.wx); o.classList.toggle("nowind", !prefs.wind);
    $(o, '[data-bm="nt"]').classList.toggle("on", prefs.nt); $(o, '[data-bm="mine"]').classList.toggle("on", prefs.mine); $(o, '[data-bm="wx"]').classList.toggle("on", prefs.wx);
    const wc = $(o, '[data-bm="wind"]'); wc.classList.toggle("on", !!prefs.wind); wc.textContent = prefs.wind ? "Winds FL" + String(prefs.wind).padStart(3, "0") : "Winds" }

  /* airport NOTAMs drawn on the runways: closed runways, closed taxiways, navaid and lighting outages */
  const norm = s => (s || "").replace(/^0?(\d)([LRC]?)$/, "0$1$2");
  function runwayOf(code, ids){ const R = RWY[code] || []; ids = ids.map(norm); return R.find(r => ids.includes(norm(r[0])) || ids.includes(norm(r[1]))) }
  function adPaint(){
    aidM.forEach(m => m.remove()); aidM = [];
    const feats = [], twy = [];
    if(B) for(const n of B.notams){ if(!n.ad || !n.adk) continue; const on = activeAt(n, T), a = apx.get(n.ad); if(!a) continue;
      if(n.adk.k === "rwy"){ const r = runwayOf(n.ad, n.adk.rwy); if(!r) continue;
        const A = [r[3], r[4]], Bp = [r[5], r[6]], k = Math.cos(A[1] * Math.PI / 180), dx = (Bp[0] - A[0]) * k, dy = Bp[1] - A[1], L = Math.hypot(dx, dy), hw = (r[2] / 2 + 6) / 111320;
        const nx = -dy / L * hw / k, ny = dx / L * hw;
        feats.push({type:"Feature", properties:{on, id:n.id}, geometry:{type:"Polygon", coordinates:[[[A[0] + nx, A[1] + ny], [Bp[0] + nx, Bp[1] + ny], [Bp[0] - nx, Bp[1] - ny], [A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny]]]}});
        for(const f of [.2, .5, .8]){ const c = [A[0] + (Bp[0] - A[0]) * f, A[1] + (Bp[1] - A[1]) * f], d = hw * 2.2;
          feats.push({type:"Feature", properties:{on, id:n.id}, geometry:{type:"LineString", coordinates:[[c[0] - d / k, c[1] - d], [c[0] + d / k, c[1] + d]]}});
          feats.push({type:"Feature", properties:{on, id:n.id}, geometry:{type:"LineString", coordinates:[[c[0] + d / k, c[1] - d], [c[0] - d / k, c[1] + d]]}}) } }
      else if(n.adk.k === "twy" && on && n.adk.twy.length){ const box = [[a.lon - .05, a.lat - .04], [a.lon + .05, a.lat - .04], [a.lon + .05, a.lat + .04], [a.lon - .05, a.lat + .04], [a.lon - .05, a.lat - .04]];
        twy.push(["all", ["in", ["get", "ref"], ["literal", n.adk.twy]], ["within", {type:"Polygon", coordinates:[box]}]]) }
      else if(n.adk.k === "aid" || n.adk.k === "lgt"){ const r = n.adk.rwy && n.adk.rwy.length ? runwayOf(n.ad, n.adk.rwy) : null; let p;
        if(r){ const end = norm(r[0]) === norm(n.adk.rwy[0]) ? [r[3], r[4], r[5], r[6]] : [r[5], r[6], r[3], r[4]], k = Math.cos(end[1] * Math.PI / 180);
          const dx = (end[0] - end[2]) * k, dy = end[1] - end[3], L = Math.hypot(dx, dy) || 1, out = (n.adk.k === "lgt" ? 450 : 700) / 111320;
          p = [end[0] + dx / L * out / k, end[1] + dy / L * out] }
        else p = [a.lon + .004 * ((aidM.length % 3) - 1), a.lat + .006];
        const e = document.createElement("div"); e.className = "bmaid" + (on ? "" : " off"); e.dataset.bmn = n.id; e.setAttribute("role", "button"); e.tabIndex = 0;
        e.innerHTML = `<b>${n.adk.k === "lgt" ? "●" : "⊗"}</b><span>${esc(n.adk.aid + (n.adk.rwy && n.adk.rwy[0] ? " " + n.adk.rwy[0] : ""))}</span>`;
        aidM.push(new lib.Marker({element:e}).setLngLat(p).addTo(map)) } }
    lastRw = feats; map.getSource("bm-rw").setData(fc(feats));
    if(hasOMT) map.setFilter("bm-twy", twy.length ? ["all", ["==", ["get", "class"], "taxiway"], ["any", ...twy]] : ["==", 1, 0]);
  }

  function winds(){
    windM.forEach(m => m.remove()); windM = []; if(!B || !prefs.wind) return;
    for(const p of B.route){ const R = B.winds[p.n] || []; if(!R.length) continue;
      const W = R.reduce((b, w) => Math.abs(w.fl - prefs.wind) < Math.abs(b.fl - prefs.wind) ? w : b, R[0]); if(Math.abs(W.fl - prefs.wind) > 40) continue;   // nearest level in this waypoint's table
      const e = document.createElement("div"); e.className = "bmwind";
      e.innerHTML = `<svg viewBox="-10 -10 20 20" style="transform:rotate(${(W.dir + 180) % 360}deg)"><path d="M0 8V-7M-4-3 0-8 4-3"/></svg><span>${String(W.dir).padStart(3, "0")}/${W.kt} ${W.t < 0 ? "M" + (-W.t) : "P" + W.t}</span>`; if(W.fl !== prefs.wind) e.classList.add("near");   // nearest level in this waypoint's table: shown a little dimmer
      windM.push(new lib.Marker({element:e, anchor:"right", offset:[-8, 0]}).setLngLat([p.lon, p.lat]).addTo(map)) } }

  /* ---------- time ---------- */
  // the time bar covers your flying day: an hour before the first departure to an hour after the last arrival of the
  // selected sector's day; with no flight plan, from an hour ago to twelve hours ahead
  function range(){ const F = B && B.flights || [], sel = F.find(f => f.key === selKey), D = F.filter(f => f.std && (!sel || f.date === sel.date));
    if(D.length){ const a = Math.min(...D.map(f => f.std)) - 36e5, b = Math.max(...D.map(f => f.sta || f.std + 3 * 36e5)) + 36e5; return [a - a % 6e5, b] }
    const now = Date.now(), s0 = now - 36e5 - now % 6e5; return [s0, s0 + 13 * 36e5] }
  function paintTime(init){
    const [a, b] = range(); slide.min = 0; slide.max = Math.round((b - a) / 6e5);
    if(init){ T = Math.min(b, Math.max(a, Date.now())); slide.value = Math.round((T - a) / 6e5) }
    $(o, ".bmtl").textContent = hhmm(T) + " · " + dayLbl(T);
    const fa = planeAt(), ck = $(o, ".bmclock"), tail = fa ? ` · ${fa.f.dep}–${fa.f.dest} ${fa.p.phase}` : Math.abs(T - Date.now()) < 6e5 ? " · now" : "", txt = hhmm(T) + tail;
    if(fa && ck._ph !== tail){ ck._ph = tail; flapIn(ck, txt.toUpperCase(), ctx.rm()) }   // a new sector or phase flips in
    else if(fa){ if(!flapBusy(ck) && ck._flap !== txt.toUpperCase()) flapIn(ck, txt.toUpperCase(), true) }   // same phase: the time changes on its tiles, no flip
    else { ck._ph = null; if(ck._flapT) ck._flapT.forEach(clearInterval); ck._flapT = null; ck._flap = null; ck.classList.remove("flap"); ck.removeAttribute("aria-label"); ck.textContent = txt }
    lastNt = ntFeatures(); map.getSource("bm-nt").setData(fc(lastNt)); adPaint(); vis(); count(); drawPlane();
  }
  function count(){ const el = $(o, ".bmcount"); if(view === "month") return;
    if(!B){ el.textContent = "No briefing loaded"; return }
    if(zoomAp){ const L = B.notams.filter(n => n.ad === zoomAp), on = L.filter(n => activeAt(n, T)).length; el.textContent = `${zoomAp}: ${on} of ${L.length} NOTAMs in force`; return }
    const S = B.notams.filter(n => n.shape), m = S.filter(n => n.mine), on = m.filter(n => activeAt(n, T)).length;
    el.textContent = prefs.mine ? `${on} active on your route · ${m.length} in all` : `${S.filter(n => activeAt(n, T)).length} of ${S.length} areas active` }
  // which planned sector is flying at time T, and where; scrubbing into another sector switches to it
  function planeAt(){ const F = B && B.flights || []; for(const f of F){ const p = flightAt(f, T); if(p) return {f, p} } return null }
  function drawPlane(){ const fa = view === "brief" ? planeAt() : null;
    if(!fa){ if(plane) plane.getElement().hidden = true; return }
    if(!plane){ const e = document.createElement("div"); e.className = "bmplane"; e.setAttribute("aria-hidden", "true");
      e.innerHTML = '<svg viewBox="-12 -12 24 24"><path d="M0-10.5c.9 0 1.4.9 1.4 1.9v5.2l8.6 4.7v2.1l-8.6-2.4v4.9l2.6 1.9v1.7L0 8.6l-4 .9V7.8l2.6-1.9V1L-10 3.4V1.3l8.6-4.7v-5.2c0-1 .5-1.9 1.4-1.9z"/></svg>';
      plane = new lib.Marker({element:e, rotationAlignment:"map", pitchAlignment:"map"}).setLngLat(fa.p.pos).addTo(map) }
    plane.getElement().hidden = false; plane.getElement().classList.toggle("gnd", fa.p.ground); plane.setLngLat(fa.p.pos).setRotation(fa.p.brg) }
  slide.addEventListener("input", () => { const [a] = range(); T = a + slide.value * 6e5;
    const fa = planeAt(); if(fa && fa.f.key !== selKey){ pick(fa.f.key); setup(); sub() }
    paintTime(false); if(sheet.classList.contains("open") && sheet.dataset.k === "ap") apSheet(zoomAp) });

  /* ---------- sheets ---------- */
  // stretchy time bar: drag past either end and the track stretches and thins a little, then springs back when you let go.
  // From ElasticSlider in React Bits (github.com/DavidHDev/react-bits), (c) David Haz, MIT + Commons Clause; rewritten here.
  (() => { let id = null, r0 = null;
    const set = over => { const W = r0 ? r0.width : slide.clientWidth || 1, sq = over ? Math.sign(over) * Math.sqrt(Math.abs(over) * W) * .45 : 0, k = Math.abs(sq) / W;
      slide.style.transformOrigin = sq < 0 ? "right center" : "left center";
      slide.style.transform = sq ? `scaleX(${1 + k}) scaleY(${1 - Math.min(.3, k * 1.5)})` : "" };
    slide.addEventListener("pointerdown", e => { if(ctx.rm()) return; id = e.pointerId; slide.classList.remove("spring"); slide.style.transform = ""; r0 = slide.getBoundingClientRect() });
    o.addEventListener("pointermove", e => { if(e.pointerId !== id || !r0) return; set(e.clientX > r0.right ? e.clientX - r0.right : e.clientX < r0.left ? e.clientX - r0.left : 0) });
    const end = e => { if(e.pointerId !== id) return; id = null; r0 = null; slide.classList.add("spring"); set(0) };
    o.addEventListener("pointerup", end); o.addEventListener("pointercancel", end) })();
  function openSheet(k, html){ sc.innerHTML = html; sheet.dataset.k = k; sheet.classList.add("open"); sheet.classList.toggle("full", k === "list" || k === "load" || k === "off"); sc.scrollTop = 0 }
  function closeSheet(){ sheet.classList.remove("open"); sheet.style.transform = "" }
  (() => { let y0 = null, t0 = 0, dy = 0, drag = false;
    sheet.addEventListener("pointerdown", e => { if(!sheet.classList.contains("open")) return; const onGrab = !!e.target.closest(".bmgrab");
      if(!onGrab && (sc.scrollTop > 0 || e.target.closest("pre,input,a,summary"))) return; y0 = e.clientY; t0 = performance.now(); dy = 0; drag = false });
    sheet.addEventListener("pointermove", e => { if(y0 == null) return; dy = e.clientY - y0;
      if(!drag && Math.abs(dy) > 8){ drag = true; sheet.style.transition = "none"; try{ sheet.setPointerCapture(e.pointerId) }catch(_){} }
      if(drag){ e.preventDefault(); sheet.style.transform = `translateY(${Math.max(-40, dy)}px)` } }, {passive:false});
    const end = () => { if(y0 == null) return; const v = dy / Math.max(1, performance.now() - t0); y0 = null; sheet.style.transition = ""; if(!drag) return; drag = false;
      sheet._swiped = performance.now();   // so the tap at the end of a swipe does nothing
      if(dy > 90 || v > .5) closeSheet(); else { sheet.style.transform = ""; if(dy < -30 || v < -.5) sheet.classList.add("full") } };
    sheet.addEventListener("pointerup", end); sheet.addEventListener("pointercancel", end) })();
  const stateTag = n => { const on = activeAt(n, T); return `<span class="bmk ${on ? "on" : ""}">${on ? "In force at " + hhmm(T) : "Not at " + hhmm(T)}</span>` };
  const validity = n => `${n.from ? hhmm(n.from) + " " + dayLbl(n.from) : "?"} to ${n.to ? hhmm(n.to) + " " + dayLbl(n.to) : "permanent"}${n.schedText ? `<br>${esc(n.schedText)}` : n.schedFromText ? "<br>Times from the text" : ""}`;
  function ntSheet(ids){
    const L = ids.map(id => B.notams.find(n => n.id === id)).filter(Boolean); if(!L.length) return;
    openSheet("nt", L.map(n => `<div class="bmn"><h4>${esc(KIND[n.kind] || "NOTAM")}<small>${esc(n.id)}</small></h4>
      <div class="bmtags"><span class="bmk" style="color:${COL[n.kind]};background:${COL[n.kind]}22">${esc(lvl(n))}</span>${stateTag(n)}${n.mine ? `<span class="bmk mine">On your route</span>` : ""}</div>
      <p class="bmv">${validity(n)}</p><pre>${esc(n.text)}</pre></div>`).join(""));
  }
  function wxBlock(k){ const w = B && B.wx[k]; if(!w) return `<p class="bmv">No weather for ${esc(k)} in this briefing.</p>`;
    const m = w.metar ? wxCat(w.metar) : w.taf ? wxCat(w.taf) : null;
    const ob = obsTime(w.metar, w.date), old = !ob || Date.now() - ob > 3 * 36e5;
    return `${m ? `<div class="bmtags"><span class="bmk" style="color:${CATC[m.cat]};background:${CATC[m.cat]}22">${CATN[m.cat]}${w.metar ? "" : " (forecast)"}</span>${ob ? `<span class="bmk${old ? " on" : ""}">Observed ${hhmm(ob)} ${dayLbl(ob)}${old ? " · old" : ""}</span>` : ""}</div>
      <div class="bmwx">${m.wind ? `<div><span>Wind</span><b>${m.wind.kt === 0 ? "Calm" : (m.wind.dir === "VRB" ? "Variable" : m.wind.dir + "°") + " " + m.wind.kt + " kt" + (m.wind.g ? " G" + m.wind.g : "")}</b></div>` : ""}
      ${m.vis != null ? `<div><span>Visibility</span><b>${m.vis >= 9999 ? "10 km+" : m.vis.toLocaleString("en-IN") + " m"}</b></div>` : ""}
      <div><span>Ceiling</span><b>${m.ceil != null ? m.ceil.toLocaleString("en-IN") + " ft" : "None"}</b></div>
      ${m.temp != null ? `<div><span>Temp</span><b>${m.temp}°</b></div>` : ""}${m.qnh ? `<div><span>QNH</span><b>${m.qnh}</b></div>` : ""}</div>` : ""}
      ${w.metar ? `<pre>METAR ${esc(w.metar)}</pre>` : ""}${w.taf ? `<pre>TAF ${esc(w.taf)}</pre>` : ""}` }
  const GROUPS = [["rwy", "Runways"], ["twy", "Taxiways"], ["aid", "Navaids"], ["lgt", "Lighting"], ["dist", "Runway distances"], ["wip", "Works"], ["gen", "Other"]];
  function apSheet(k){
    const a = apx.get(k) || {}, L = B ? B.notams.filter(n => n.ad === k) : [], role = !B ? "" : k === B.dep ? "Departure" : k === B.dest ? "Destination" : (B.altn || []).includes(k) ? "Alternate" : "";
    const from = L.length && L[0].locDate ? `<p class="bmv dim">NOTAMs from the briefing of ${dayLbl(L[0].locDate)}</p>` : "";
    openSheet("ap", `<div class="bmn"><h4>${esc(k)} · ${esc(a.city || (B && B.wx[k] && B.wx[k].name) || "")}${role ? `<small>${role}</small>` : ""}</h4>${wxBlock(k)}${from}</div>
      ${L.length ? GROUPS.map(([g, t]) => { const G = L.filter(n => (n.adk || {}).k === g); if(!G.length) return "";
        return `<div class="bmgh">${t}</div>` + G.map(n => `<details class="bmd${activeAt(n, T) ? "" : " off"}"><summary><span>${esc(n.text.split("\n")[0].slice(0, 90))}</span>${stateTag(n)}</summary><p class="bmv">${esc(n.id)} · ${validity(n)}</p><pre>${esc(n.text)}</pre></details>`).join("") }).join("") : `<p class="bmv">No airport NOTAMs for ${esc(k)} in this briefing.</p>`}`);
  }
  function listSheet(){
    if(!B){ openSheet("list", emptyHtml()); return }
    const S = B.notams.filter(n => n.shape && (!prefs.mine || n.mine)).sort((a, b) => activeAt(b, T) - activeAt(a, T));
    const cr = (B.fl || 350) * 100, aup = B.aup.filter(r => r.lo <= cr + 2000 && r.hi >= cr - 2000);
    const tnow = (() => { const d = new Date(T); return d.getUTCHours() * 100 + d.getUTCMinutes() })(), aOn = r => +r.a <= tnow && tnow <= +r.b;
    const other = B.notams.filter(n => !n.shape && !n.ad && n.kind !== "aup");
    openSheet("list", `<div class="bmn"><h4>${esc(B.dep || "")}${B.dest ? " to " + esc(B.dest) : ""}<small>${B.date ? dayLbl(B.date) : ""}${B.fl ? " · FL" + B.fl : ""}</small></h4>
        ${B.flights && B.flights.length > 1 ? `<p class="bmv">${B.flights.length} sectors: ${B.flights.map((f, i) => `${i + 1}. ${esc(secLbl(f))}${f.std ? " " + hhmm(f.std) + "–" + (f.sta ? hhmm(f.sta) : "?") : ""}`).join(" · ")}</p>` : ""}
        <p class="bmv">${B.route.length} waypoints · ${B.notams.length} NOTAMs · ${Object.keys(B.wx).length} airports with weather</p></div>
      <div class="bmgh">Areas ${prefs.mine ? "on your route" : ""} (${S.length})</div>
      ${S.map(n => `<div role="button" tabindex="0" class="bmrow" data-bmn="${esc(n.id)}"><i style="background:${COL[n.kind]}"></i><span>${esc(KIND[n.kind])}<small>${esc(lvl(n))}</small></span>${stateTag(n)}</div>`).join("") || `<p class="bmv">None.</p>`}
      <div class="bmgh">Airports</div>
      ${[B.dep, B.dest, ...(B.altn || [])].filter(Boolean).map(k => `<div role="button" tabindex="0" class="bmrow" data-bmap="${esc(k)}"><i style="background:#8a94a6"></i><span>${esc(k)}<small>${B.notams.filter(n => n.ad === k).length} NOTAMs</small></span><span class="bmk">Zoom in</span></div>`).join("")}
      <details class="bmd"><summary><span>Airspace activations at FL${B.fl || 350} (${aup.length})</span></summary>${aup.map(r => `<p class="bmv${aOn(r) ? "" : " dim"}"><b>${esc(r.id)}</b> ${esc(r.place)} ${r.a}-${r.b}Z ${esc(r.loT)} to ${esc(r.hiT)}</p>`).join("")}<p class="bmv">The briefing gives these as names only, so they cannot be drawn.</p></details>
      <details class="bmd"><summary><span>Other NOTAMs, no area (${other.length})</span></summary>${other.map(n => `<p class="bmv"><b>${esc(n.id)}</b> ${esc(n.sect || "")}</p><pre>${esc(n.text)}</pre>`).join("")}</details>
      <label class="bmbtn"><input type="file" accept="application/pdf,.pdf" hidden>Add another flight plan</label>
      <p class="bmv dim">Holding NOTAMs for ${B.places} places from your briefings. A new briefing replaces the places it covers.</p>
      <div role="button" tabindex="0" class="bmbtn ghost" data-bm="drop">Remove all briefings from the phone</div>`) }
  function emptyHtml(){ return `<div class="bmn"><h4>Add today's briefing</h4><p class="bmv">Tap the upload button at the top and pick the briefing PDF. It is read on this phone: the route, NOTAMs, airport weather and winds are drawn on the map. Each new briefing updates the places it covers and keeps the rest. Nothing is uploaded, and it is kept off your backups.</p>
      <label class="bmbtn"><input type="file" accept="application/pdf,.pdf" hidden>Choose briefing PDF</label></div>` }

  /* ---------- offline ---------- */
  function dlInfo(){ try{ return JSON.parse(localStorage.getItem(DLKEY) || "null") }catch(e){ return null } }
  async function offSheet(){
    const d = dlInfo(); let mb = ""; try{ const e = await navigator.storage.estimate(); mb = Math.round((e.usage || 0) / 1048576) + " MB used by the app on this phone" }catch(e){}
    openSheet("off", `<div class="bmn"><h4>Offline map</h4>
      <p class="bmv">${d ? `Saved for <b>${esc(d.label)}</b> on ${new Date(d.at).toLocaleDateString("en-GB", {day:"numeric", month:"short"})}: ${d.n.toLocaleString("en-IN")} map tiles.` : "Nothing saved yet."} ${mb ? "<br>" + mb + "." : ""}</p>
      <p class="bmv">Saves the map 50 NM either side of ${B && routePts.length > 1 ? "the briefing's route" : "a route"}, and street-level detail around ${B ? "the departure, destination and alternates" : "the airports"}. Do it on Wi-Fi or at the gate; then it works in the air with no signal. A new download replaces the last one.</p>
      ${!styleOK ? `<p class="bmv warn">No connection now: connect to download.</p>` : B && routePts.length > 1 ? `<div role="button" tabindex="0" class="bmbtn" data-bm="dl">Download for ${esc(B.dep || "")} to ${esc(B.dest || "")}</div>` : `<p class="bmv">Load a briefing first, so the map knows the route.</p>`}
      <div class="bmprog" hidden><i></i></div><p class="bmv bmpt"></p>
      ${d ? `<div role="button" tabindex="0" class="bmbtn ghost" data-bm="dldel">Delete the offline map</div>` : ""}</div>`) }
  let dlBusy = false;
  async function download(){
    if(dlBusy || !styleOK) return; dlBusy = true; const pt = $(sc, ".bmpt"), bar = $(sc, ".bmprog"), btn = $(sc, '[data-bm="dl"]'); bar.hidden = false; if(btn) btn.classList.add("busy");
    try{
      const tj = JSON.parse(await (await cget(HOST + "/planet", true)).text()), tpl = tj.tiles[0];
      let set = null; for(const opt of [{cz:10, cr:50, ar:12, zr:4}, {cz:10, cr:30, ar:8, zr:3}, {cz:9, cr:30, ar:6, zr:2}, {cz:9, cr:20, ar:4, zr:1}]){ set = tilePlan(routePts, apts, opt); if(set.size <= MAXTILES) break }
      // both looks: their styles, sprites and fonts (the tiles are the same)
      const extra = [];
      for(const kk of ["light", "dark"]){ let raw = raws[kk]; if(!raw){ try{ raw = raws[kk] = await (await cget(STYLES[kk], true)).text() }catch(e){ continue } }
        const st = JSON.parse(raw);
        const sp = typeof st.sprite === "string" ? [st.sprite] : (st.sprite || []).map(s => s.url); sp.forEach(u => extra.push(u + ".json", u + ".png", u + "@2x.json", u + "@2x.png"));
        const fonts = new Set(); (st.layers || []).forEach(l => { const f = l.layout && l.layout["text-font"]; if(Array.isArray(f) && f.every(x => typeof x === "string")) fonts.add(f.join(",")) });
        if(st.glyphs) fonts.forEach(f => ["0-255", "256-511", "8192-8447"].forEach(r => extra.push(st.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r)))) }
      const urls = [...set].map(k => { const [z, x, y] = k.split("/"); return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y) }).concat([...new Set(extra)]);
      let done = 0, bad = 0, i = 0; const tick = () => { bar.firstChild.style.width = (done / urls.length * 100).toFixed(1) + "%"; pt.textContent = `${done.toLocaleString("en-IN")} of ${urls.length.toLocaleString("en-IN")}${bad ? ` · ${bad} failed` : ""}` };
      try{ navigator.storage && navigator.storage.persist && navigator.storage.persist() }catch(e){}
      await Promise.all([0, 1, 2, 3].map(async () => { while(i < urls.length && !closed){ const u = urls[i++]; try{ await cget(u, false) }catch(e){ bad++ } done++; if(done % 8 === 0) tick() } }));
      tick();
      // keep only this flight's tiles
      try{ const c = await caches.open(MCACHE), keep = new Set(urls); for(const r of await c.keys()) if(/\.pbf$/.test(new URL(r.url).pathname) && !keep.has(r.url)) await c.delete(r) }catch(e){}
      localStorage.setItem(DLKEY, JSON.stringify({at:Date.now(), n:set.size, label:`${B.dep || ""} to ${B.dest || ""}`}));
      pt.textContent = bad ? `Saved, but ${bad} pieces failed. Try again on a better connection.` : "Saved. The map now works with no signal along this route.";
      setTimeout(() => { if(sheet.dataset.k === "off" && sheet.classList.contains("open")) offSheet() }, 1600);
    }catch(e){ pt.textContent = "Could not download: " + (e.message || e) + ". Check the connection and try again." }
    dlBusy = false; if(btn) btn.classList.remove("busy");
  }

  /* ---------- reading a new PDF ---------- */
  async function readPdf(file){
    if(!file) return; openSheet("load", `<div class="bmn"><h4>Reading the briefing…</h4><div class="bmprog"><i></i></div><p class="bmv bmpt">Opening the PDF</p></div>`);
    const bar = $(sc, ".bmprog i"), pt = $(sc, ".bmpt");
    try{
      const pdf = await ctx.pdfLib(), lines = await pdfLines(pdf, await file.arrayBuffer(), f => { bar.style.width = (f * 100).toFixed(0) + "%"; pt.textContent = `Page ${Math.round(f * 100)}%` });
      const nb = parseBriefing(lines);
      if(!nb.route.length && !nb.notams.length){ openSheet("load", `<div class="bmn"><h4>Nothing found</h4><p class="bmv">This PDF does not look like a briefing: no route and no NOTAMs were found in it.</p></div>`); return }
      S = mergeBrief(S || emptyStore(), nb); await putStore(S); B = viewOf(S); if(S.added) selKey = S.added;
      if(view !== "brief") setView("brief", false); setup(); sub();
      openSheet("load", `<div class="bmn"><h4>Briefing loaded</h4><p class="bmv">${nb.dep && nb.dest ? `${esc(nb.dep)} to ${esc(nb.dest)}, ` : ""}${nb.route.length} waypoints, ${nb.notams.filter(n => n.shape).length} NOTAM areas (${B.notams.filter(n => n.mine).length} near your route), ${nb.notams.filter(n => n.ad).length} airport NOTAMs, weather for ${Object.keys(nb.wx).length} airports.</p>
        <p class="bmv">Updated ${S.updated} place${S.updated === 1 ? "" : "s"} (FIRs and airports) from this briefing${S.kept ? `; ${S.kept} kept from earlier briefings` : ""}. NOTAMs drop off when they expire.</p>
        ${B.flights.length > 1 ? `<p class="bmv">Flight plans on the phone: ${B.flights.map((f, i) => `${i + 1}. ${esc(secLbl(f))}${f.std ? " " + hhmm(f.std) : ""}`).join(" · ")}. Pick a sector above the time bar for its route and winds.</p>` : ""}
        ${nb.route.length && nb.std ? "" : nb.route.length ? `<p class="bmv">No departure time in this plan, so the aircraft cannot be placed by time.</p>` : `<p class="bmv">No flight plan in this PDF: its NOTAMs and weather were added, the sectors are unchanged.</p>`}</div>`);
      sc.querySelector(".bmn").insertAdjacentHTML("beforeend", `<label class="bmbtn"><input type="file" accept="application/pdf,.pdf" hidden>Add another flight plan</label>`);
      if(S.added){ const f = B.flights.find(x => x.key === S.added); if(f && f.std){ const [a, b] = range(); T = Math.min(b, Math.max(a, f.std)); slide.value = Math.round((T - a) / 6e5); paintTime(false) } }
    }catch(e){ openSheet("load", `<div class="bmn"><h4>Could not read the PDF</h4><p class="bmv">${esc(e.message || e)}</p></div>`) }
  }
  o.addEventListener("change", e => { const f = e.target.closest('input[type="file"]'); if(f && f.files[0]){ readPdf(f.files[0]); f.value = "" } });

  /* ---------- airport close-up ---------- */
  function zoomTo(k){ const a = apx.get(k); if(!a) return; zoomAp = k;
    map.flyTo({center:[a.lon, a.lat], zoom:13.4, pitch:45, bearing:0, duration:ctx.rm() ? 0 : 2200, essential:true}); apSheet(k); count() }
  map.on("zoomend", () => { const z = map.getZoom(); $(o, ".bmback").hidden = z < 9 || view === "month"; o.classList.toggle("near", z >= 10.5); o.classList.toggle("far", z < 5);
    if(z < 9 && zoomAp){ zoomAp = null; count() } });

  /* ---------- taps ---------- */
  map.on("click", e => {
    if(view === "month"){ const p = jets && jets.hit(e.point.x, e.point.y); if(p){ jets.follow(p); return }
      if(jets && (jets.following || jets.focused)){ jets.release(true); return }
      const r = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], {layers:["bm-mrl", "bm-mrd"]});
      if(r.length){ monthSheet("route", r[0].properties.k); return } closeSheet(); return }
    if(!B) return; const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
    const rw = map.queryRenderedFeatures(box, {layers:["bm-rwf", "bm-rwx"]}); if(rw.length){ ntSheet([...new Set(rw.map(f => f.properties.id))]); return }
    const f = map.queryRenderedFeatures(box, {layers:["bm-ntf", "bm-ntl", "bm-ntp"]}); if(f.length){ ntSheet([...new Set(f.map(x => x.properties.id))].slice(0, 6)); return }
    if(sheet.classList.contains("open") && sheet.dataset.k !== "load") closeSheet();
  });
  for(const id of ["bm-ntf", "bm-ntp", "bm-rwf"]){ map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = "") }
  o.addEventListener("click", e => {
    if(sheet._swiped && performance.now() - sheet._swiped < 350 && e.target.closest(".bmsheet")) return;
    if(e.target.closest("[data-sheet]")){ close(); return }   // a flight in the month view: the app opens its sheet once the map has closed
    const sc2 = e.target.closest("[data-bmsec]"); if(sc2){ pick(sc2.dataset.bmsec); setup(); sub(); const f = B.flights.find(x => x.key === selKey);
      if(f && f.std){ const [a, b] = range(); T = Math.min(b, Math.max(a, f.std)); slide.value = Math.round((T - a) / 6e5) } paintTime(false); fitRoute(true); return }
    const stn = e.target.closest("[data-bmst]"); if(stn){ if(jets) jets.focus(stn.dataset.bmst); else monthSheet("stn", stn.dataset.bmst); return }
    const ap = e.target.closest("[data-bmap]"); if(ap){ zoomTo(ap.dataset.bmap); return }
    const nn = e.target.closest("[data-bmn]"); if(nn){ const n = B && B.notams.find(x => x.id === nn.dataset.bmn); if(n){ ntSheet([n.id]);
        if(n.shape){ const P = n.shape.t === "circle" ? circlePoly(n.shape.c, n.shape.r, 16) : n.shape.p || [n.shape.c];
          const b = P.reduce((b, p) => [[Math.min(b[0][0], p[0]), Math.min(b[0][1], p[1])], [Math.max(b[1][0], p[0]), Math.max(b[1][1], p[1])]], [[180, 90], [-180, -90]]);
          map.fitBounds(b, {padding:{top:120, bottom:Math.round(innerHeight * .55), left:60, right:60}, maxZoom:10, duration:ctx.rm() ? 0 : 900}) } } return }
    const t = e.target.closest("[data-bm]"); if(!t) return; const k = t.dataset.bm;
    if(k === "route"){ zoomAp = null; closeSheet(); fitRoute(true); count() }
    else if(k === "sheet") sheet.classList.toggle("full");
    else if(k === "nt"){ prefs.nt = !prefs.nt; savePrefs(); vis() }
    else if(k === "mine"){ prefs.mine = !prefs.mine; savePrefs(); vis(); count() }
    else if(k === "wx"){ prefs.wx = !prefs.wx; savePrefs(); vis() }
    else if(k === "wind"){ const fls = B ? [...new Set(Object.values(B.winds).flat().map(w => w.fl))].sort((a, b) => b - a) : [];
      if(!fls.length){ openSheet("wind", `<div class="bmn"><h4>Winds aloft</h4><p class="bmv">${B ? "This briefing has no winds table." : "Load a briefing to see the winds at each waypoint."}</p></div>`); return }
      const cr = B.fl ? fls.reduce((b, f) => Math.abs(f - B.fl) < Math.abs(b - B.fl) ? f : b, fls[0]) : fls[0];   // the table level nearest the cruise level
      if(!prefs.wind) prefs.wind = cr; else { const i = fls.indexOf(prefs.wind); prefs.wind = i < 0 ? cr : fls[(i + 1) % fls.length]; if(prefs.wind === cr) prefs.wind = 0 }
      savePrefs(); winds(); vis() }
    else if(k === "list") listSheet();
    else if(k === "off") offSheet();
    else if(k === "dl") download();
    else if(k === "dldel"){ caches.delete(MCACHE).then(() => { localStorage.removeItem(DLKEY); offSheet() }) }
    else if(k === "drop"){ dropBrief().then(() => { S = null; B = null; setup(); paintTime(true); sub(); openSheet("list", emptyHtml()) }) }
    else if(k === "fit"){ if(jets) jets.release(false); closeSheet(); fitMonth(true) }
    else if(k === "look"){ prefs.look = {auto:"light", light:"dark", dark:"auto"}[prefs.look] || "auto"; savePrefs(); applyLook();
      toast(LOOKS[prefs.look]) }
    else if(k === "vmonth"){ if(!solo && M && view !== "month") setView("month", true) }
    else if(k === "vbrief"){ if(!solo && view !== "brief") setView("brief", true) }
  });
  o.addEventListener("keydown", e => { if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-bmap],[data-bmn],[data-bmst],[data-bmsec]")){ e.preventDefault(); e.stopPropagation(); e.target.click() } });

  // NOTAMs that reach their end time while the map is open go straight away, and the phone's copy is updated
  var expiry = setInterval(() => { if(closed || !S) return; if(prune(S)){ putStore(S); B = viewOf(S); if(B) markMine(B, routePts, apts); paintTime(false); if(sheet.classList.contains("open") && sheet.dataset.k === "list") listSheet() } }, 60000);   // var, so closing before this line runs is safe
  function sub(){ if(view === "month") return; const d = dlInfo(); $(o, ".bmsub").textContent = B ? `${B.dep || "?"} to ${B.dest || "?"}${B.date ? " · " + dayLbl(B.date) : ""}${d ? " · offline map saved" : ""}` : styleOK ? "No briefing yet · tap upload" : "Offline · no saved map here" }
  function close(){ if(closed) return; closed = true; clearInterval(expiry); removeEventListener("keydown", onEsc); document.documentElement.classList.remove("sheet-open", "bm-open"); mq.removeEventListener && mq.removeEventListener("change", onScheme); if(jets) jets.kill(); try{ map.remove() }catch(e){} o.remove(); if(window.__bm && window.__bm.map === map) window.__bm = null; if(ctx.onClose) ctx.onClose() }

  // opens on the briefing when one is loaded for about now (6 h before its day to the end of the next), else the month
  if(B && B.flights) selKey = defaultKey();
  const now = Date.now(), fresh = B && ((B.flights || []).some(f => f.date && now > f.date - 6 * 36e5 && now < f.date + 48 * 36e5) || (B.date && now > B.date - 6 * 36e5 && now < B.date + 48 * 36e5));
  view = ctx.view || (fresh || !M ? "brief" : "month");
  // the Month map and the Briefing map are separate: each opens on its own view and there is no switch between them
  if(solo) $(o, ".bmseg").style.display = "none";
  monthSetup(); setup(); paintTime(true); setView(view, "open"); lookBtn();
  function onEsc(e){ if(e.key === "Escape" && !document.querySelector("#sheetWrap:not([hidden])")) close() }   // hoisted, so closing early is safe
  addEventListener("keydown", onEsc);
  return {close, el:o, map};
}
export { mergeBrief, viewOf, emptyStore, loadLib, cget, toP, STYLES, HOST };   // tests, and the OSINT map
