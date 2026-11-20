/* The map (lab). One full-screen 3D globe (MapLibre, OpenFreeMap tiles) with two views:
   Month: the month's routes with the 737s flying them; tap a plane, route or airport for the flights behind it.
   Briefing: the planned route, NOTAM areas with their levels and active times, airport weather, winds aloft, and a
   close-up of each airport with its runway, taxiway and navaid NOTAMs.
   Briefings build up by place: each new PDF replaces the NOTAMs and weather for the places it covers (FIR sections and
   airports, NIL ones included) and leaves the rest; NOTAMs drop off when they expire. Read on the phone and kept only in
   this phone's storage, never in backups. "Offline" saves the map along the route so it works with no signal.
   Map data: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors. Runways: OurAirports. */
import { parseBriefing, activeAt, wxCat, locKey, obsTime } from "./briefparse.js?b=69";
import { RWY, ICAO } from "./rwydata.js?b=69";

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
const ftTxt = (f, raw) => raw ? raw : f == null ? "?" : f === 0 ? "SFC" : f >= 99999 ? "UNL" : f >= 10000 ? "FL" + Math.round(f / 100) : f.toLocaleString("en-IN") + " ft";
const prefs = (() => { try{ return Object.assign({nt:true, wx:true, mine:true, wind:0, look:"auto"}, JSON.parse(localStorage.getItem(PREFKEY) || "{}")) }catch(e){ return {nt:true, wx:true, mine:true, wind:0, look:"auto"} } })();
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
const emptyStore = () => ({v:2, last:null, locs:{}, wx:{}, aup:null});
async function putStore(S){ try{ const c = await caches.open(BCACHE); await c.put(SKEY, new Response(JSON.stringify(S), {headers:{"Content-Type":"application/json"}})) }catch(e){} }
function prune(S){ const now = Date.now(); for(const k in S.locs) S.locs[k].notams = S.locs[k].notams.filter(n => n.to == null || n.to >= now - 36e5) }
async function loadStore(){
  try{ const c = await caches.open(BCACHE); const r = await c.match(SKEY); let S = r ? await r.json() : null;
    if(!S){ const old = await c.match(BKEY); if(old){ S = mergeBrief(emptyStore(), await old.json()); await c.delete(BKEY); await putStore(S) } }   // build 65 kept one briefing
    if(S) prune(S); return S }catch(e){ return null } }
function mergeBrief(S, nb){
  const groups = {}; (nb.sects || []).forEach(k => groups[k] = []);
  for(const n of nb.notams){ if(n.kind === "aup") continue; const k = locKey(n); (groups[k] = groups[k] || []).push(n) }
  const kept = Object.keys(S.locs).filter(k => !(k in groups)).length;
  for(const k in groups) S.locs[k] = {date:nb.date, notams:groups[k]};
  for(const k in nb.wx) S.wx[k] = Object.assign({}, nb.wx[k], {date:nb.date});
  if(nb.aup && nb.aup.length) S.aup = {date:nb.date, rows:nb.aup};
  if(nb.route.length || nb.dep) S.last = {date:nb.date, dep:nb.dep, dest:nb.dest, altn:nb.altn, route:nb.route, fl:nb.fl, winds:nb.winds};
  S.updated = Object.keys(groups).length; S.kept = kept; return S }
function viewOf(S){
  if(!S) return null; const L = S.last || {}, seen = new Set(), notams = [];
  for(const k in S.locs) for(const n of S.locs[k].notams){ if(seen.has(n.id)) continue; seen.add(n.id); n.locDate = S.locs[k].date; notams.push(n) }
  if(!notams.length && !S.last && !Object.keys(S.wx).length) return null;
  return {date:L.date || null, dep:L.dep || null, dest:L.dest || null, altn:L.altn || [], route:L.route || [], fl:L.fl || null, winds:L.winds || {},
    notams, wx:S.wx, aup:S.aup ? S.aup.rows : [], places:Object.keys(S.locs).length} }
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
function markMine(B, routePts, apts){
  const {pts, D} = sampleRoute(routePts), cr = (B.fl || 350) * 100, climb = Math.min(130, D / 2.2), desc = Math.min(120, D / 2.2);
  const alt = s => s < climb ? cr * s / climb : s > D - desc ? cr * (D - s) / desc : cr;
  for(const n of B.notams){ n.mine = false; if(!n.shape) continue;
    if(apts.some(a => shapeDist(a, n.shape) <= 25)){ n.mine = true; continue }
    const lo = n.lo == null ? 0 : n.lo, hi = n.hi == null ? 99999 : n.hi;
    n.mine = pts.some(q => shapeDist(q.p, n.shape) <= 5 && lo <= alt(q.s) + 2000 && hi >= alt(q.s) - 2000) }
}

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

/* ======================================================================================================== */
export async function openBriefMap(ctx){
  const lib = await loadLib(), apx = ctx.apx, base = ctx.base || "BOM";
  const o = document.createElement("div"); o.className = "bm"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Map");
  o.innerHTML = `<div class="bmtop">
      <div role="button" tabindex="0" class="wclose hz" data-bm="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
      <div class="bmt"><b class="bmtt">Map</b><span class="bmsub">Loading the map…</span></div>
      <div class="bmseg" role="tablist" aria-label="View"><div role="tab" tabindex="0" data-bm="vmonth">Month</div><div role="tab" tabindex="0" data-bm="vbrief">Briefing</div></div>
      <div role="button" tabindex="0" class="wclose hz bmfit" data-bm="fit" aria-label="Back to all routes"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></div>
      <label class="wclose hz bmup" aria-label="Upload briefing PDF"><input type="file" accept="application/pdf,.pdf" hidden><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></label>
    </div>
    <div class="bmmap"></div>
    <div class="bmpills"><span class="bmpill bmclock"></span><span class="bmpill bmcount"></span></div>
    <div role="button" tabindex="0" class="bmpill bmback" data-bm="route" hidden>← Route</div>
    <div role="button" tabindex="0" class="bmlook" data-bm="look"></div>
    <div class="bmsheet" aria-live="polite"><div class="bmgrab" data-bm="sheet"></div><div class="bmsc"></div></div>
    <div class="bmbar">
      <div class="bmmonth"></div>
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
  window.__bm = {map, get look(){ return o.dataset.look }, get B(){ return B }, get S(){ return S }, get view(){ return view }, get route(){ return routePts }, get nt(){ return lastNt }, get rw(){ return lastRw }, get jets(){ return jets }};
  await new Promise(ok => { if(map.isStyleLoaded()) ok(); else map.once("style.load", ok) });
  if(closed) return;

  /* ---------- overlay layers (added again after a change of look) ---------- */
  const fc = f => ({type:"FeatureCollection", features:f || []});
  const ntF = ["==", ["geometry-type"], "Polygon"], ntL = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]], ntP = ["==", ["geometry-type"], "Point"];
  let hasOMT = false, BRIEF_LAYERS = [];
  const MONTH_LAYERS = ["bm-mrc", "bm-mrl", "bm-mrd"];
  function addOverlays(){
  const dk = o.dataset.look === "dark";
  map.addSource("bm-nt", {type:"geojson", data:fc()}); map.addSource("bm-rt", {type:"geojson", data:fc()}); map.addSource("bm-rw", {type:"geojson", data:fc()});
  map.addLayer({id:"bm-ntf", type:"fill", source:"bm-nt", filter:ntF, paint:{"fill-color":["get", "c"], "fill-opacity":["case", ["get", "on"], .26, .06]}});
  map.addLayer({id:"bm-ntl", type:"line", source:"bm-nt", filter:ntL, paint:{"line-color":["get", "c"], "line-width":1.6, "line-opacity":["case", ["get", "on"], .95, .35]}});
  map.addLayer({id:"bm-ntp", type:"circle", source:"bm-nt", filter:ntP, paint:{"circle-color":["get", "c"], "circle-radius":6, "circle-opacity":["case", ["get", "on"], .9, .3], "circle-stroke-color":"#fff", "circle-stroke-width":1}});
  map.addLayer({id:"bm-rtc", type:"line", source:"bm-rt", paint:{"line-color":dk ? "#000" : "#0b1626", "line-width":5, "line-opacity":dk ? .7 : .55}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rtl", type:"line", source:"bm-rt", paint:{"line-color":"#f6f1e4", "line-width":2.4}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rwf", type:"fill", source:"bm-rw", filter:ntF, paint:{"fill-color":"#ff5a45", "fill-opacity":["case", ["get", "on"], .55, .1]}});
  map.addLayer({id:"bm-rwx", type:"line", source:"bm-rw", filter:["==", ["geometry-type"], "LineString"], paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5], "line-opacity":["case", ["get", "on"], 1, .2]}});
  hasOMT = !!(map.getStyle().sources || {}).openmaptiles;
  if(hasOMT) map.addLayer({id:"bm-twy", type:"line", source:"openmaptiles", "source-layer":"aeroway", minzoom:11, filter:["==", 1, 0],
    paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 12, 2, 16, 9], "line-dasharray":[1.4, .8]}});

  map.addSource("bm-mr", {type:"geojson", data:fc()});
  map.addLayer({id:"bm-mrc", type:"line", source:"bm-mr", paint:{"line-color":"#0b1626", "line-width":5, "line-opacity":.4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrl", type:"line", source:"bm-mr", filter:["!", ["get", "dh"]], paint:{"line-color":"#e9b949", "line-width":2.4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrd", type:"line", source:"bm-mr", filter:["get", "dh"], paint:{"line-color":"#e9b949", "line-width":2, "line-opacity":.7, "line-dasharray":[2, 1.6]}});
  BRIEF_LAYERS = ["bm-ntf", "bm-ntl", "bm-ntp", "bm-rtc", "bm-rtl", "bm-rwf", "bm-rwx"].concat(hasOMT ? ["bm-twy"] : []);
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
     - each leg takes 7 to 20 s by distance; out, 1.8 s on the ground at the far end (hidden), back, 1.8 s at home; nose first
     - quadratic ease along each leg; a random start for each plane
     - grows out of the runway over the first 30% of the track on the climb, shrinks over the last 30% to nothing at touchdown
     - same size on screen at any zoom; deadheads as a see-through jet
     - tap a plane: it slows to about a third of its pace, the detailed 737 is swapped in, the camera flies in low behind it
       (about 21 degrees above the horizon) with a smoothed heading; drag to swing round it, pinch to move in and out,
       it stays followed; its route line goes faint and the others fainter; the details bubble floats above it
     - tap an airport: the camera turns to it, routes through it stay bright and the rest dim, its bubble floats above it
     - tap empty map: let go, and pull back out to the overview distance where you are
     - airport tags never pile on each other; while following, tags near the jet fade out of its way
     - the view flies in on opening; the globe button goes back to all routes; Escape closes */
  const SLOW = .35, G = 1.8, EL = Math.atan2(.065, .17), FZ = 6.9;   // EL: camera height behind the jet; FZ: follow zoom
  let overviewZoom = 4;
  async function startJets(){
    if(!M || closed) return; if(jets){ jets.run(); return }
    let THREE, build737; try{ THREE = await import("./vendor/three/three.module.min.js"); ({build737} = await import("./jet737.js?b=69")) }catch(e){ return }
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
      const A = [r.A.lon, r.A.lat], B2 = [r.B.lon, r.B.lat], dur = Math.max(7, Math.min(20, gcNm(A, B2) / 3440.065 * 47)), cyc = dur * 2 + G * 2;
      return {r, T, g, j, A, B:B2, dur, cyc, tt:Math.random() * cyc, rate:1, vis:0, pos:A, from:r.a} });
    let raf = 0, running = false, F = null, foc = null, last = 0;
    const orb = {yaw:0, pitch:0, zoom:1};
    const bub = document.createElement("div"); bub.className = "gbubble bmfol"; bub.hidden = true; $(o, ".bmmap").appendChild(bub);
    const bp = {x:0, y:0, sx:-1, sy:-1};
    const size = () => { const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight; R.setSize(W, H, false); cam.right = W; cam.bottom = -H; cam.updateProjectionMatrix() };
    size(); map.on("resize", size);
    const brgOf = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return (Math.atan2(y, x) / r + 360) % 360 };
    const wrap = d => ((d + 540) % 360) - 180, ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2, ramp = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) };
    const lerpK = (k, dt) => 1 - Math.pow(1 - k, dt * 60);   // a per-frame lerp at 60 fps, the same at any frame rate
    function showBub(kind, key, from){ bub.innerHTML = M.bubble(kind, key, from); bub.hidden = false; bub.dataset.kind = kind; bp.sx = -1;
      if(!ctx.rm()){ bub.classList.remove("pop"); void bub.offsetWidth; bub.classList.add("pop") } }
    function lines(mode, key){   // route line brightness: normal, following one route, or focused on an airport
      const op = mode === "follow" ? ["case", ["==", ["get", "k"], key], .35, .15] : mode === "stn" ? ["case", ["in", key, ["get", "k"]], 1, .25] : null;
      map.setPaintProperty("bm-mrl", "line-opacity", op || 1); map.setPaintProperty("bm-mrd", "line-opacity", op || .7); map.setPaintProperty("bm-mrc", "line-opacity", op ? ["*", .4, op] : .4) }
    function frame(now){
      if(!running || closed) return; raf = requestAnimationFrame(frame);
      if(document.hidden){ last = now; return }
      const dt = Math.min(.05, last ? (now - last) / 1000 : 0); last = now;
      for(const p of planes){
        p.rate += ((p === F ? SLOW : 1) - p.rate) * Math.min(1, dt * 2.5);   // eases down to a third when selected, back up when let go
        p.tt = (p.tt + dt * p.rate) % p.cyc; const tt = ctx.rm() ? p.dur * .5 : p.tt;
        let t, dir, u = -1;
        if(tt < p.dur){ u = tt / p.dur; t = ease(u); dir = 1 } else if(tt < p.dur + G){ t = 1; dir = -1 } else if(tt < p.dur * 2 + G){ u = (tt - p.dur - G) / p.dur; t = 1 - ease(u); dir = -1 } else { t = 0; dir = 1 }
        p.vis = u < 0 ? 0 : Math.pow(ramp(Math.min(t, 1 - t) / .3), .8);
        const tc = Math.max(.0005, Math.min(.9995, t)), t0 = Math.max(0, tc - .004), t1 = Math.min(1, tc + .004);
        p.pos = gcAt(p.A, p.B, tc); p.tail = gcAt(p.A, p.B, dir > 0 ? t0 : t1); p.nose = gcAt(p.A, p.B, dir > 0 ? t1 : t0);
        const from = dir > 0 ? p.r.a : p.r.b; if(p === F && from !== p.from && !bub.hidden) showBub("route", p.r.k, from); p.from = from;
      }
      // follow: low behind the jet, heading smoothed so a turnaround swings round gently; drag and pinch move round it
      if(F){ const hd = brgOf(F.tail, F.nose); F.sb = F.sb == null ? hd : (F.sb + wrap(hd - F.sb) * lerpK(ctx.rm() ? 1 : .04, dt) + 360) % 360;
        const k = lerpK(ctx.rm() ? 1 : .08, dt), c = map.getCenter(), el = EL + orb.pitch;
        const want = {bearing:(F.sb + orb.yaw * 180 / Math.PI + 360) % 360, pitch:Math.max(0, Math.min(70, 90 - el * 180 / Math.PI)), zoom:FZ - Math.log2(orb.zoom)};
        map.jumpTo({center:[c.lng + wrap(F.pos[0] - c.lng) * k, c.lat + (F.pos[1] - c.lat) * k], zoom:map.getZoom() + (want.zoom - map.getZoom()) * k,
          pitch:map.getPitch() + (want.pitch - map.getPitch()) * k, bearing:map.getBearing() + wrap(want.bearing - map.getBearing()) * k}) }
      else if(foc){ const k = lerpK(ctx.rm() ? 1 : .08, dt), c = map.getCenter();
        map.jumpTo({center:[c.lng + wrap(foc.lon - c.lng) * k, c.lat + (foc.lat - c.lat) * k], zoom:map.getZoom() + (foc.z - map.getZoom()) * k, pitch:map.getPitch() * (1 - k), bearing:map.getBearing() * (1 - k)}) }
      const ctr = map.getCenter(), cen = [ctr.lng, ctr.lat], pitch = map.getPitch() * Math.PI / 180, z = map.getZoom();
      const px = 30 / .034, fpx = 230 / .034 / orb.zoom;   // ~30 px on screen at any zoom; the followed jet ~230 px, as close as the old chase view
      for(const p of planes){
        if(p.vis <= .01 || gcNm(cen, p.pos) > 4800){ p.T.visible = false; p.sx = null; continue }   // on the ground, or round the back of the globe
        const a = map.project(p.pos), t = map.project(p.tail), n = map.project(p.nose); p.T.visible = true;
        p.T.position.set(a.x, -a.y, 0); p.T.rotation.x = -pitch * .85 - .28; p.g.rotation.z = Math.atan2(-(n.y - t.y), n.x - t.x) + Math.PI / 2;
        p.T.scale.setScalar((p === F ? fpx : px) * Math.max(p.vis, .001)); p.sx = a.x; p.sy = a.y;
      }
      R.render(scene, cam);
      // airport tags: none on top of another; while following, those near the jet step out of its way
      const placed = []; const fx = F && F.sx != null ? [F.sx, F.sy] : null;
      for(const m of mMarkers){ const ll = m.getLngLat(), q = map.project(ll), e = m.getElement();
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
      if(on){ if(!baseD) baseD = build737({detail:true}); const d = baseD.clone(true); if(p.r.dh) ghost(d); d.rotation.x = Math.PI / 2; p.g.add(d); p.jd = d; p.j.visible = false }
      else if(p.jd){ p.g.remove(p.jd); p.jd = null; p.j.visible = true }
    }
    // while following, your finger moves the camera round the jet instead of the map
    const handlers = ["dragPan", "dragRotate", "touchZoomRotate", "touchPitch", "scrollZoom", "doubleClickZoom", "keyboard"];
    const freeMap = on => handlers.forEach(h => { try{ on ? map[h].enable() : map[h].disable() }catch(e){} });
    const ptrs = new Map(); let st = null, pinch = null; const box = map.getCanvasContainer();
    box.addEventListener("pointerdown", e => { if(!F) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(ptrs.size === 1) st = {x:e.clientX, y:e.clientY, yaw:orb.yaw, pitch:orb.pitch};
      if(ptrs.size === 2){ const [p, q] = [...ptrs.values()]; pinch = {d:Math.hypot(p.x - q.x, p.y - q.y), zoom:orb.zoom} } });
    box.addEventListener("pointermove", e => { if(!F || !ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(ptrs.size === 2 && pinch){ const [p, q] = [...ptrs.values()]; orb.zoom = Math.max(.45, Math.min(3, pinch.zoom * pinch.d / Math.max(20, Math.hypot(p.x - q.x, p.y - q.y)))); return }
      if(ptrs.size === 1 && st){ const dx = e.clientX - st.x, dy = e.clientY - st.y; if(Math.hypot(dx, dy) < 10) return;
        orb.yaw = st.yaw - dx * .008; orb.pitch = Math.max(-.3, Math.min(1.1, st.pitch + dy * .006)) } });
    const up = e => { ptrs.delete(e.pointerId); if(ptrs.size < 2) pinch = null; if(ptrs.size === 1){ const [p] = [...ptrs.values()]; st = {x:p.x, y:p.y, yaw:orb.yaw, pitch:orb.pitch} } };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", e => { if(!F) return; e.preventDefault(); orb.zoom = Math.max(.45, Math.min(3, orb.zoom * Math.exp(e.deltaY * .0012))) }, {passive:false});
    jets = {planes, el:cv,
      run(){ if(running) return; running = true; cv.hidden = false; last = 0; raf = requestAnimationFrame(frame) },
      stop(){ running = false; cancelAnimationFrame(raf); cv.hidden = true; this.release(false) },
      hit(x, y){ let best = null, d = 30; for(const p of planes){ if(!p.T.visible || p.sx == null || p.vis < .5) continue; const q = Math.hypot(p.sx - x, p.sy - y); if(q < d){ d = q; best = p } } return best },
      follow(p){ if(F === p) return; if(F) detail(F, false); foc = null; closeSheet(); F = p; F.sb = null; orb.yaw = 0; orb.pitch = 0; orb.zoom = 1;
        detail(p, true); showBub("route", p.r.k, p.from); lines("follow", p.r.k); freeMap(false); o.classList.add("following"); if(ctx.haptics) ctx.haptics(bub) },
      focus(code){ const s = M.stations.find(x => x.code === code); if(!s) return; if(F){ detail(F, false); F = null; freeMap(true) }
        closeSheet(); foc = {lon:s.lon, lat:s.lat, z:Math.max(map.getZoom(), overviewZoom + .6)}; showBub("stn", code); lines("stn", code); o.classList.remove("following");
        setTimeout(() => { foc && (foc.z = map.getZoom()) }, ctx.rm() ? 0 : 1600) },   // once there, the map is yours to move
      release(flyOut){ const was = F || foc; if(F) detail(F, false); F = null; foc = null; bub.hidden = true; lines(); freeMap(true); o.classList.remove("following");
        mMarkers.forEach(m => { const e = m.getElement(); e._op = null; e.classList.remove("tagoff", "tagdim") });
        if(was && flyOut) map.easeTo({zoom:Math.min(map.getZoom(), overviewZoom), pitch:0, bearing:0, duration:ctx.rm() ? 0 : 700}) },
      get following(){ return F }, get focused(){ return foc },
      kill(){ this.stop(); try{ R.dispose() }catch(e){} cv.remove(); bub.remove() } };
    // panning the map yourself while an airport is focused lets go of it
    ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(ev => map.on(ev, e => { if(e.originalEvent && foc){ foc = null } }));
    if(view === "month") jets.run();
  }
  function monthSheet(kind, key, dirFrom){ if(!M || !M.bubble) return; const h = M.bubble(kind, key, dirFrom); if(!h) return; if(jets) jets.release(false);
    openSheet("month", `<div class="bmbub">${h}</div>`) }

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
    if(v === "month"){ $(o, ".bmtt").textContent = M.label; $(o, ".bmsub").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · tap a plane to follow it`;
      $(o, ".bmmonth").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · ${M.stations.length} airports · drag to spin, pinch to zoom`;
      $(o, ".bmcount").textContent = M.label; fitMonth(anim); startJets() }
    else { if(jets) jets.stop(); $(o, ".bmtt").textContent = "Briefing map"; vis(); sub(); count(); if(B) fitRoute(anim === true); if(!B) openSheet("list", emptyHtml()) }
  }

  /* ---------- briefing to map ---------- */
  function setup(){
    markers.forEach(m => m.remove()); markers = []; zoomAp = null;
    if(!B){ routePts = []; apts = []; map.getSource("bm-rt").setData(fc()); windM.forEach(m => m.remove()); windM = []; return }
    routePts = B.route.length > 1 ? B.route.map(p => [p.lon, p.lat]) : [B.dep, B.dest].map(k => apx.get(k)).filter(Boolean).map(a => [a.lon, a.lat]);
    apts = [B.dep, B.dest, ...(B.altn || [])].map(k => apx.get(k)).filter(Boolean).map(a => [a.lon, a.lat]);
    markMine(B, routePts, apts);
    map.getSource("bm-rt").setData(fc(routePts.length > 1 ? [{type:"Feature", properties:{}, geometry:{type:"LineString", coordinates:routePts}}] : []));
    // waypoints
    B.route.slice(1, -1).forEach(p => { const e = document.createElement("div"); e.className = "bmwp"; e.innerHTML = `<i></i><span>${esc(p.n)}</span>`;
      markers.push(new lib.Marker({element:e, anchor:"left", offset:[-5, 0]}).setLngLat([p.lon, p.lat]).addTo(map)) });
    // airports: weather colour, tap for the close-up
    const codes = [...new Set([B.dep, B.dest, ...(B.altn || []), ...Object.keys(B.wx)].filter(Boolean))];
    codes.forEach(k => { const a = apx.get(k); if(!a) return; const w = B.wx[k], m = w && (w.metar ? wxCat(w.metar) : w.taf ? wxCat(w.taf) : null), ob = w && obsTime(w.metar, w.date);
      const e = document.createElement("div"); e.className = "bmap" + ([B.dep, B.dest].includes(k) ? " main" : "") + (B.altn && B.altn.includes(k) ? " alt" : "") + (!ob || Date.now() - ob > 3 * 36e5 ? " stale" : "");
      e.setAttribute("role", "button"); e.tabIndex = 0; e.dataset.bmap = k; e.setAttribute("aria-label", k + " airport");
      e.innerHTML = `<i style="background:${m ? CATC[m.cat] : "#8a94a6"}"></i><span>${esc(k)}</span>`;
      markers.push(new lib.Marker({element:e, anchor:"left", offset:[-7, 0]}).setLngLat([a.lon, a.lat]).addTo(map)) });
    winds(); paintTime(true); if(view === "brief") fitRoute(false);
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
      e.innerHTML = `<svg viewBox="-10 -10 20 20" style="transform:rotate(${(W.dir + 180) % 360}deg)"><path d="M0 8V-7M-4-3 0-8 4-3"/></svg><span>${String(W.dir).padStart(3, "0")}/${W.kt} ${W.t < 0 ? "M" + (-W.t) : "P" + W.t}${W.fl !== prefs.wind ? ` <em>FL${W.fl}</em>` : ""}</span>`;
      windM.push(new lib.Marker({element:e, anchor:"right", offset:[-8, 0]}).setLngLat([p.lon, p.lat]).addTo(map)) } }

  /* ---------- time ---------- */
  function range(){ const now = Date.now(), s = B && B.date && now > B.date - 6 * 36e5 && now < B.date + 30 * 36e5 ? B.date : now - 6 * 36e5 - now % 9e5; return [s, s + 30 * 36e5] }
  function paintTime(init){
    const [a, b] = range(); slide.min = 0; slide.max = Math.round((b - a) / 6e5);
    if(init){ T = Math.min(b, Math.max(a, Date.now())); slide.value = Math.round((T - a) / 6e5) }
    $(o, ".bmtl").textContent = hhmm(T) + " · " + dayLbl(T);
    $(o, ".bmclock").textContent = hhmm(T) + (Math.abs(T - Date.now()) < 6e5 ? " · now" : "");
    lastNt = ntFeatures(); map.getSource("bm-nt").setData(fc(lastNt)); adPaint(); vis(); count();
  }
  function count(){ const el = $(o, ".bmcount"); if(view === "month") return;
    if(!B){ el.textContent = "No briefing loaded"; return }
    if(zoomAp){ const L = B.notams.filter(n => n.ad === zoomAp), on = L.filter(n => activeAt(n, T)).length; el.textContent = `${zoomAp}: ${on} of ${L.length} NOTAMs in force`; return }
    const S = B.notams.filter(n => n.shape), m = S.filter(n => n.mine), on = m.filter(n => activeAt(n, T)).length;
    el.textContent = prefs.mine ? `${on} active on your route · ${m.length} in all` : `${S.filter(n => activeAt(n, T)).length} of ${S.length} areas active` }
  slide.addEventListener("input", () => { const [a] = range(); T = a + slide.value * 6e5; paintTime(false); if(sheet.classList.contains("open") && sheet.dataset.k === "ap") apSheet(zoomAp) });

  /* ---------- sheets ---------- */
  function openSheet(k, html){ sc.innerHTML = html; sheet.dataset.k = k; sheet.classList.add("open"); sheet.classList.toggle("full", k === "list" || k === "load" || k === "off"); sc.scrollTop = 0 }
  function closeSheet(){ sheet.classList.remove("open") }
  const stateTag = n => { const on = activeAt(n, T); return `<span class="bmk ${on ? "on" : ""}">${on ? "In force at " + hhmm(T) : "Not at " + hhmm(T)}</span>` };
  const validity = n => `${n.from ? hhmm(n.from) + " " + dayLbl(n.from) : "?"} to ${n.to ? hhmm(n.to) + " " + dayLbl(n.to) : "permanent"}${n.schedText ? `<br>${esc(n.schedText)}` : n.schedFromText ? "<br>Times from the text" : ""}`;
  function ntSheet(ids){
    const L = ids.map(id => B.notams.find(n => n.id === id)).filter(Boolean); if(!L.length) return;
    openSheet("nt", L.map(n => `<div class="bmn"><h4>${esc(KIND[n.kind] || "NOTAM")}<small>${esc(n.id)}</small></h4>
      <div class="bmtags"><span class="bmk" style="color:${COL[n.kind]};background:${COL[n.kind]}22">${esc(ftTxt(n.lo, n.loT))} to ${esc(ftTxt(n.hi, n.hiT))}</span>${stateTag(n)}${n.mine ? `<span class="bmk mine">On your route</span>` : ""}</div>
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
        <p class="bmv">${B.route.length} waypoints · ${B.notams.length} NOTAMs · ${Object.keys(B.wx).length} airports with weather</p></div>
      <div class="bmgh">Areas ${prefs.mine ? "on your route" : ""} (${S.length})</div>
      ${S.map(n => `<div role="button" tabindex="0" class="bmrow" data-bmn="${esc(n.id)}"><i style="background:${COL[n.kind]}"></i><span>${esc(KIND[n.kind])}<small>${esc(ftTxt(n.lo, n.loT))} to ${esc(ftTxt(n.hi, n.hiT))}</small></span>${stateTag(n)}</div>`).join("") || `<p class="bmv">None.</p>`}
      <div class="bmgh">Airports</div>
      ${[B.dep, B.dest, ...(B.altn || [])].filter(Boolean).map(k => `<div role="button" tabindex="0" class="bmrow" data-bmap="${esc(k)}"><i style="background:#8a94a6"></i><span>${esc(k)}<small>${B.notams.filter(n => n.ad === k).length} NOTAMs</small></span><span class="bmk">Zoom in</span></div>`).join("")}
      <details class="bmd"><summary><span>Airspace activations at FL${B.fl || 350} (${aup.length})</span></summary>${aup.map(r => `<p class="bmv${aOn(r) ? "" : " dim"}"><b>${esc(r.id)}</b> ${esc(r.place)} ${r.a}-${r.b}Z ${esc(r.loT)} to ${esc(r.hiT)}</p>`).join("")}<p class="bmv">The briefing gives these as names only, so they cannot be drawn.</p></details>
      <details class="bmd"><summary><span>Other NOTAMs, no area (${other.length})</span></summary>${other.map(n => `<p class="bmv"><b>${esc(n.id)}</b> ${esc(n.sect || "")}</p><pre>${esc(n.text)}</pre>`).join("")}</details>
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
      S = mergeBrief(S || emptyStore(), nb); await putStore(S); B = viewOf(S);
      if(view !== "brief") setView("brief", false); setup(); sub();
      openSheet("load", `<div class="bmn"><h4>Briefing loaded</h4><p class="bmv">${nb.dep && nb.dest ? `${esc(nb.dep)} to ${esc(nb.dest)}, ` : ""}${nb.route.length} waypoints, ${nb.notams.filter(n => n.shape).length} NOTAM areas (${B.notams.filter(n => n.mine).length} near your route), ${nb.notams.filter(n => n.ad).length} airport NOTAMs, weather for ${Object.keys(nb.wx).length} airports.</p>
        <p class="bmv">Updated ${S.updated} place${S.updated === 1 ? "" : "s"} (FIRs and airports) from this briefing${S.kept ? `; ${S.kept} kept from earlier briefings` : ""}. NOTAMs drop off when they expire.</p></div>`);
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
    if(e.target.closest("[data-sheet]")){ close(); return }   // a flight in the month view: the app opens its sheet once the map has closed
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
    else if(k === "vmonth"){ if(M && view !== "month") setView("month", true) }
    else if(k === "vbrief"){ if(view !== "brief") setView("brief", true) }
  });
  o.addEventListener("keydown", e => { if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-bmap],[data-bmn],[data-bmst]")){ e.preventDefault(); e.stopPropagation(); e.target.click() } });

  function sub(){ if(view === "month") return; const d = dlInfo(); $(o, ".bmsub").textContent = B ? `${B.dep || "?"} to ${B.dest || "?"}${B.date ? " · " + dayLbl(B.date) : ""}${d ? " · offline map saved" : ""}` : styleOK ? "No briefing yet · tap upload" : "Offline · no saved map here" }
  function close(){ if(closed) return; closed = true; removeEventListener("keydown", onEsc); document.documentElement.classList.remove("sheet-open", "bm-open"); mq.removeEventListener && mq.removeEventListener("change", onScheme); if(jets) jets.kill(); try{ map.remove() }catch(e){} o.remove(); if(ctx.onClose) ctx.onClose() }

  // opens on the briefing when one is loaded for about now (6 h before its day to the end of the next), else the month
  const now = Date.now(), fresh = B && B.date && now > B.date - 6 * 36e5 && now < B.date + 48 * 36e5;
  view = ctx.view || (fresh || !M ? "brief" : "month");
  monthSetup(); setup(); paintTime(true); setView(view, "open"); lookBtn();
  function onEsc(e){ if(e.key === "Escape" && !document.querySelector("#sheetWrap:not([hidden])")) close() }   // hoisted, so closing early is safe
  addEventListener("keydown", onEsc);
  return {close, el:o, map};
}
export { mergeBrief, viewOf, emptyStore };   // for the tests
