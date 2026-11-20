/* The map (lab). One full-screen 3D globe (MapLibre, OpenFreeMap tiles) with two views:
   Month: the month's routes with the 737s flying them; tap a plane, route or airport for the flights behind it.
   Briefing: the planned route, NOTAM areas with their levels and active times, airport weather, winds aloft, and a
   close-up of each airport with its runway, taxiway and navaid NOTAMs.
   Briefings build up by place: each new PDF replaces the NOTAMs and weather for the places it covers (FIR sections and
   airports, NIL ones included) and leaves the rest; NOTAMs drop off when they expire. Read on the phone and kept only in
   this phone's storage, never in backups. "Offline" saves the map along the route so it works with no signal.
   Map data: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors. Runways: OurAirports. */
import { parseBriefing, activeAt, wxCat, locKey, obsTime } from "./briefparse.js?b=66";
import { RWY, ICAO } from "./rwydata.js?b=66";

const HOST = "https://tiles.openfreemap.org", PHOST = "ptc://tiles.openfreemap.org", STYLE = HOST + "/styles/liberty";
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
const prefs = (() => { try{ return Object.assign({nt:true, wx:true, mine:true, wind:0}, JSON.parse(localStorage.getItem(PREFKEY) || "{}")) }catch(e){ return {nt:true, wx:true, mine:true, wind:0} } })();
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
      <label class="wclose hz bmup" aria-label="Upload briefing PDF"><input type="file" accept="application/pdf,.pdf" hidden><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></label>
    </div>
    <div class="bmmap"></div>
    <div class="bmpills"><span class="bmpill bmclock"></span><span class="bmpill bmcount"></span></div>
    <div role="button" tabindex="0" class="bmpill bmback" data-bm="route" hidden>← Route</div>
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

  /* ---------- style: OpenFreeMap online or saved; plain coastlines if neither ---------- */
  let style, rawStyle = null;
  try{ rawStyle = await (await cget(STYLE, true)).text(); style = JSON.parse(toP(rawStyle)); styleOK = true }
  catch(e){ const g = await import("./globedata.js"); const rings = s => s.split("|").map(r => r.trim().split(" ").map(p => p.split(",").map(Number)));
    style = {version:8, sources:{coast:{type:"geojson", data:{type:"FeatureCollection", features:[g.WORLD, g.REGION].map(s => ({type:"Feature", properties:{}, geometry:{type:"MultiLineString", coordinates:rings(s)}}))}}},
      layers:[{id:"bg", type:"background", paint:{"background-color":"#10213a"}}, {id:"coast", type:"line", source:"coast", paint:{"line-color":"#7d9cc4", "line-width":1}}]} }
  if(closed) return;
  style.projection = {type:"globe"};
  const c0 = apx.get(base) || {lon:73, lat:19};
  map = new lib.Map({container:$(o, ".bmmap"), style, center:[c0.lon, c0.lat], zoom:3.6, maxPitch:70, attributionControl:{compact:true}, fadeDuration:0});
  map.on("error", () => {});
  window.__bm = {map, get B(){ return B }, get S(){ return S }, get view(){ return view }, get route(){ return routePts }, get nt(){ return lastNt }, get rw(){ return lastRw }, get jets(){ return jets }};
  await new Promise(ok => { if(map.isStyleLoaded()) ok(); else map.once("style.load", ok) });
  if(closed) return;

  /* ---------- overlay layers ---------- */
  const fc = f => ({type:"FeatureCollection", features:f || []});
  map.addSource("bm-nt", {type:"geojson", data:fc()}); map.addSource("bm-rt", {type:"geojson", data:fc()}); map.addSource("bm-rw", {type:"geojson", data:fc()});
  const ntF = ["==", ["geometry-type"], "Polygon"], ntL = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]], ntP = ["==", ["geometry-type"], "Point"];
  map.addLayer({id:"bm-ntf", type:"fill", source:"bm-nt", filter:ntF, paint:{"fill-color":["get", "c"], "fill-opacity":["case", ["get", "on"], .26, .06]}});
  map.addLayer({id:"bm-ntl", type:"line", source:"bm-nt", filter:ntL, paint:{"line-color":["get", "c"], "line-width":1.6, "line-opacity":["case", ["get", "on"], .95, .35]}});
  map.addLayer({id:"bm-ntp", type:"circle", source:"bm-nt", filter:ntP, paint:{"circle-color":["get", "c"], "circle-radius":6, "circle-opacity":["case", ["get", "on"], .9, .3], "circle-stroke-color":"#fff", "circle-stroke-width":1}});
  map.addLayer({id:"bm-rtc", type:"line", source:"bm-rt", paint:{"line-color":"#0b1626", "line-width":5, "line-opacity":.55}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rtl", type:"line", source:"bm-rt", paint:{"line-color":"#f6f1e4", "line-width":2.4}, layout:{"line-cap":"round", "line-join":"round"}});
  map.addLayer({id:"bm-rwf", type:"fill", source:"bm-rw", filter:ntF, paint:{"fill-color":"#ff5a45", "fill-opacity":["case", ["get", "on"], .55, .1]}});
  map.addLayer({id:"bm-rwx", type:"line", source:"bm-rw", filter:["==", ["geometry-type"], "LineString"], paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5], "line-opacity":["case", ["get", "on"], 1, .2]}});
  const hasOMT = !!(map.getStyle().sources || {}).openmaptiles;
  if(hasOMT) map.addLayer({id:"bm-twy", type:"line", source:"openmaptiles", "source-layer":"aeroway", minzoom:11, filter:["==", 1, 0],
    paint:{"line-color":"#ff5a45", "line-width":["interpolate", ["linear"], ["zoom"], 12, 2, 16, 9], "line-dasharray":[1.4, .8]}});

  map.addSource("bm-mr", {type:"geojson", data:fc()});
  map.addLayer({id:"bm-mrc", type:"line", source:"bm-mr", paint:{"line-color":"#0b1626", "line-width":5, "line-opacity":.4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrl", type:"line", source:"bm-mr", filter:["!", ["get", "dh"]], paint:{"line-color":"#e9b949", "line-width":2.4}, layout:{"line-cap":"round"}});
  map.addLayer({id:"bm-mrd", type:"line", source:"bm-mr", filter:["get", "dh"], paint:{"line-color":"#e9b949", "line-width":2, "line-opacity":.7, "line-dasharray":[2, 1.6]}});
  const BRIEF_LAYERS = ["bm-ntf", "bm-ntl", "bm-ntp", "bm-rtc", "bm-rtl", "bm-rwf", "bm-rwx"].concat(hasOMT ? ["bm-twy"] : []), MONTH_LAYERS = ["bm-mrc", "bm-mrl", "bm-mrd"];
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
    map.fitBounds(b, {padding:{top:130, bottom:150, left:60, right:60}, duration:anim && !ctx.rm() ? 1100 : 0, pitch:0, bearing:0, maxZoom:7}) }
  async function startJets(){
    if(!M || closed) return; if(jets){ jets.run(); return }
    let THREE, build737; try{ THREE = await import("./vendor/three/three.module.min.js"); ({build737} = await import("./jet737.js?b=66")) }catch(e){ return }
    if(closed) return;
    const cv = document.createElement("canvas"); cv.className = "bmjets"; map.getCanvasContainer().insertBefore(cv, map.getCanvas().nextSibling);
    let R; try{ R = new THREE.WebGLRenderer({canvas:cv, alpha:true, antialias:true}) }catch(e){ cv.remove(); return }
    R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 0, -1, -3000, 3000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4658, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-300, 400, 900); scene.add(sun);
    const base = build737({detail:false});
    const planes = M.routes.map((r, i) => { const g = new THREE.Group(), j = base.clone(true);
      if(r.dh) j.traverse(m => { if(m.isMesh){ m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = .5 } });
      j.rotation.x = Math.PI / 2 - .32; g.add(j); scene.add(g);
      const A = [r.A.lon, r.A.lat], B2 = [r.B.lon, r.B.lat], L = gcNm(A, B2), dur = Math.max(6, Math.min(14, L / 70));
      return {r, g, A, B:B2, dur, off:(i * .37) % 1, cyc:2 * dur + 2, pos:null, from:r.a} });
    let raf = 0, running = false;
    const size = () => { const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight; R.setSize(W, H, false); cam.right = W; cam.bottom = -H; cam.updateProjectionMatrix() };
    size(); map.on("resize", size);
    function frame(now){
      if(!running || closed) return; raf = requestAnimationFrame(frame);
      if(document.hidden) return;
      const ctr = map.getCenter(), cen = [ctr.lng, ctr.lat], px = 30 * (map.getZoom() > 7 ? 1.25 : 1) / .034;
      for(const p of planes){
        let ph = ((now / 1000) + p.off * p.cyc) % p.cyc, f, fwd = true;
        if(ctx.rm()){ f = .5 } else if(ph < p.dur){ f = ph / p.dur } else if(ph < p.dur + 1){ f = 1 } else if(ph < 2 * p.dur + 1){ f = 1 - (ph - p.dur - 1) / p.dur; fwd = false } else { f = 0; fwd = false }
        f = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        const ll = gcAt(p.A, p.B, f), ahead = gcAt(p.A, p.B, Math.min(1, Math.max(0, f + (fwd ? .01 : -.01))));
        p.pos = ll; p.from = fwd ? p.r.a : p.r.b;
        if(gcNm(cen, ll) > 4800){ p.g.visible = false; continue }   // round the back of the globe
        const a = map.project(ll), b = map.project(ahead); p.g.visible = true;
        p.g.position.set(a.x, -a.y, 0); p.g.rotation.z = Math.atan2(-(b.y - a.y), b.x - a.x) + Math.PI / 2; p.g.scale.setScalar(px * (p.sel ? 1.3 : 1));
        p.sx = a.x; p.sy = a.y;
      }
      R.render(scene, cam);
    }
    jets = {planes, el:cv,
      run(){ if(running) return; running = true; cv.hidden = false; raf = requestAnimationFrame(frame) },
      stop(){ running = false; cancelAnimationFrame(raf); cv.hidden = true },
      hit(x, y){ let best = null, d = 30; for(const p of planes){ if(!p.g.visible || p.sx == null) continue; const q = Math.hypot(p.sx - x, p.sy - y); if(q < d){ d = q; best = p } } return best },
      select(k){ planes.forEach(p => p.sel = p.r.k === k) },
      kill(){ this.stop(); try{ R.dispose() }catch(e){} cv.remove() } };
    if(view === "month") jets.run();
  }
  function monthSheet(kind, key, dirFrom){ if(!M || !M.bubble) return; const h = M.bubble(kind, key, dirFrom); if(!h) return;
    openSheet("month", `<div class="bmbub">${h}</div>`); if(jets) jets.select(kind === "route" ? key : null) }

  /* ---------- switching views ---------- */
  function setView(v, anim){
    if(v === "month" && !M) v = "brief"; view = v; o.dataset.view = v;
    $(o, '[data-bm="vmonth"]').setAttribute("aria-selected", String(v === "month")); $(o, '[data-bm="vbrief"]').setAttribute("aria-selected", String(v === "brief"));
    $(o, '[data-bm="vmonth"]').classList.toggle("dis", !M);
    BRIEF_LAYERS.forEach(id => map.setLayoutProperty(id, "visibility", v === "brief" ? "visible" : "none"));
    MONTH_LAYERS.forEach(id => map.setLayoutProperty(id, "visibility", v === "month" ? "visible" : "none"));
    closeSheet(); zoomAp = null;
    if(v === "month"){ $(o, ".bmtt").textContent = M.label; $(o, ".bmsub").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · tap a plane or airport`;
      $(o, ".bmmonth").textContent = `${M.routes.length} route${M.routes.length === 1 ? "" : "s"} · ${M.stations.length} airports · drag to spin, pinch to zoom`;
      $(o, ".bmcount").textContent = M.label; fitMonth(anim); startJets() }
    else { if(jets) jets.stop(); $(o, ".bmtt").textContent = "Briefing map"; vis(); sub(); count(); if(B) fitRoute(anim); if(!B) openSheet("list", emptyHtml()) }
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
    if(dlBusy || !rawStyle) return; dlBusy = true; const pt = $(sc, ".bmpt"), bar = $(sc, ".bmprog"), btn = $(sc, '[data-bm="dl"]'); bar.hidden = false; if(btn) btn.classList.add("busy");
    try{
      const tj = JSON.parse(await (await cget(HOST + "/planet", true)).text()), tpl = tj.tiles[0];
      let set = null; for(const opt of [{cz:10, cr:50, ar:12, zr:4}, {cz:10, cr:30, ar:8, zr:3}, {cz:9, cr:30, ar:6, zr:2}, {cz:9, cr:20, ar:4, zr:1}]){ set = tilePlan(routePts, apts, opt); if(set.size <= MAXTILES) break }
      const st = JSON.parse(rawStyle), extra = [];
      const sp = typeof st.sprite === "string" ? [st.sprite] : (st.sprite || []).map(s => s.url); sp.forEach(u => extra.push(u + ".json", u + ".png", u + "@2x.json", u + "@2x.png"));
      const fonts = new Set(); (st.layers || []).forEach(l => { const f = l.layout && l.layout["text-font"]; if(Array.isArray(f) && f.every(x => typeof x === "string")) fonts.add(f.join(",")) });
      if(st.glyphs) fonts.forEach(f => ["0-255", "256-511", "8192-8447"].forEach(r => extra.push(st.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r))));
      const urls = [...set].map(k => { const [z, x, y] = k.split("/"); return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y) }).concat(extra);
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
    if(view === "month"){ const p = jets && jets.hit(e.point.x, e.point.y); if(p){ monthSheet("route", p.r.k, p.from); return }
      const r = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], {layers:["bm-mrl", "bm-mrd"]});
      if(r.length){ monthSheet("route", r[0].properties.k); return } closeSheet(); if(jets) jets.select(null); return }
    if(!B) return; const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
    const rw = map.queryRenderedFeatures(box, {layers:["bm-rwf", "bm-rwx"]}); if(rw.length){ ntSheet([...new Set(rw.map(f => f.properties.id))]); return }
    const f = map.queryRenderedFeatures(box, {layers:["bm-ntf", "bm-ntl", "bm-ntp"]}); if(f.length){ ntSheet([...new Set(f.map(x => x.properties.id))].slice(0, 6)); return }
    if(sheet.classList.contains("open") && sheet.dataset.k !== "load") closeSheet();
  });
  for(const id of ["bm-ntf", "bm-ntp", "bm-rwf"]){ map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = "") }
  o.addEventListener("click", e => {
    if(e.target.closest("[data-sheet]")){ close(); return }   // a flight in the month view: the app opens its sheet once the map has closed
    const stn = e.target.closest("[data-bmst]"); if(stn){ monthSheet("stn", stn.dataset.bmst); return }
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
    else if(k === "vmonth"){ if(M && view !== "month") setView("month", true) }
    else if(k === "vbrief"){ if(view !== "brief") setView("brief", true) }
  });
  o.addEventListener("keydown", e => { if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-bmap],[data-bmn],[data-bmst]")){ e.preventDefault(); e.stopPropagation(); e.target.click() } });

  function sub(){ if(view === "month") return; const d = dlInfo(); $(o, ".bmsub").textContent = B ? `${B.dep || "?"} to ${B.dest || "?"}${B.date ? " · " + dayLbl(B.date) : ""}${d ? " · offline map saved" : ""}` : styleOK ? "No briefing yet · tap upload" : "Offline · no saved map here" }
  function close(){ if(closed) return; closed = true; document.documentElement.classList.remove("sheet-open", "bm-open"); if(jets) jets.kill(); try{ map.remove() }catch(e){} o.remove(); if(ctx.onClose) ctx.onClose() }

  // opens on the briefing when one is loaded for about now (6 h before its day to the end of the next), else the month
  const now = Date.now(), fresh = B && B.date && now > B.date - 6 * 36e5 && now < B.date + 48 * 36e5;
  view = ctx.view || (fresh || !M ? "brief" : "month");
  monthSetup(); setup(); paintTime(true); setView(view, false);
  return {close, el:o, map};
}
export { mergeBrief, viewOf, emptyStore };   // for the tests
