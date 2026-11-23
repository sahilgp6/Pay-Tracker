/* Pay Tracker lab: OSINT screen (build 91). Opens full screen from the OSINT tab, tactical look after OSIRIS
   (github.com/simplifaisoul/osiris, MIT; notice in vendor/osiris/LICENSE.md). Data comes through my relay pt-osint,
   is kept on the phone (Cache Storage pt-osint-v1) and shown with its age when offline; it refreshes itself when
   there is signal. Satellites keep moving offline (positions worked out here from saved orbits, satellite.js, MIT).
   Nothing about my flights, roster or name is sent anywhere. */
const RELAY = "https://pt-osint.sahilgp6.workers.dev", OC = "pt-osint-v1", PKEY = "pt.osint";
const MIN = 60e3, H = 60 * MIN;
const FEEDS = {
  quakes:{u:"/quakes", ttl:5 * MIN}, disasters:{u:"/disasters", ttl:30 * MIN}, events:{u:"/events", ttl:30 * MIN},
  fires:{u:"/fires", ttl:H, text:1}, kp:{u:"/space?which=kp", ttl:10 * MIN}, flares:{u:"/space?which=flares", ttl:15 * MIN},
  alerts:{u:"/space?which=alerts", ttl:15 * MIN}, tle:{u:"/tle?group=visual", ttl:12 * H, text:1}, stations:{u:"/tle?group=stations", ttl:12 * H, text:1},
  mil:{u:"/military", ttl:MIN}, rain:{u:"/rain", ttl:10 * MIN},
  sdn:{u:"/sanctions", ttl:7 * 24 * H, text:1}, feodo:{u:"/threats", ttl:6 * H}, kev:{u:"/kev", ttl:24 * H}
};
const SMALL = ["quakes", "disasters", "events", "kp", "flares", "alerts", "tle", "stations", "fires"];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const zulu = t => new Date(t).toISOString().slice(11, 19) + "Z";
const ago = t => { if(!t) return "never"; const m = Math.round((Date.now() - t) / MIN); return m < 1 ? "now" : m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d" };
const prefs = (() => { try{ return Object.assign({on:{ac:1, sat:1, quake:1, fire:1, dis:1, rain:0, ship:0, cam:0}, look:"map", proj:"globe"}, JSON.parse(localStorage.getItem(PKEY) || "{}")) }catch(e){ return {on:{ac:1, sat:1, quake:1, fire:1, dis:1, rain:0}, look:"map", proj:"globe"} } })();
const savePrefs = () => { try{ localStorage.setItem(PKEY, JSON.stringify(prefs)) }catch(e){} };

/* ---------- feeds: saved copy first when fresh, network when stale, saved copy again when offline ---------- */
async function getFeed(k, force){
  const F = FEEDS[k], url = RELAY + F.u; let c = null, hit = null, at = 0;
  try{ c = await caches.open(OC); hit = await c.match(url); if(hit) at = +hit.headers.get("x-at") || 0 }catch(e){}
  const fresh = hit && Date.now() - at < F.ttl;
  if((!fresh || force) && navigator.onLine !== false){
    try{
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, {signal:ctl.signal}); clearTimeout(tm);
      if(r.ok){ const body = await r.text(); at = Date.now();
        if(c) await c.put(url, new Response(body, {headers:{"content-type":"text/plain", "x-at":String(at)}})).catch(() => {});
        return {data:F.text ? body : JSON.parse(body), at, live:true} }
    }catch(e){}
  }
  if(!hit) return {data:null, at:0, live:false};
  const body = await hit.text(); return {data:F.text ? body : JSON.parse(body), at, live:fresh};
}
// opening the app with signal (or signal coming back) quietly refreshes the small feeds, so they are there offline
let busy = false;
export async function refreshSmall(){
  if(busy || navigator.onLine === false) return; busy = true;
  try{ for(const k of SMALL) await getFeed(k); await runQueue() }catch(e){} busy = false;
}

/* ---------- parsing ---------- */
const P = {
  quakes:d => (d && d.features || []).map(f => ({k:"quake", id:f.id, lon:f.geometry.coordinates[0], lat:f.geometry.coordinates[1], dep:f.geometry.coordinates[2], mag:f.properties.mag, place:f.properties.place, t:f.properties.time, url:f.properties.url})),
  disasters:d => (d || []).map((e, i) => ({k:"gdacs", id:"g" + i, lon:e.lon, lat:e.lat, title:e.title, type:e.type, level:e.level, country:e.country, t:Date.parse(e.from) || 0, url:e.link})),
  events:d => (d && d.events || []).map(e => { const g = (e.geometry || []).slice(-1)[0]; if(!g || g.type !== "Point") return null;
    return {k:"eonet", id:e.id, lon:g.coordinates[0], lat:g.coordinates[1], title:e.title, cat:(e.categories[0] || {}).title || "Event", t:Date.parse(g.date) || 0, url:(e.sources[0] || {}).url} }).filter(Boolean),
  fires:txt => { if(!txt) return []; const L = txt.split("\n"), h = L[0].split(","), ix = n => h.indexOf(n), la = ix("latitude"), lo = ix("longitude"), fr = ix("frp"), cf = ix("confidence"), dt = ix("acq_date"), tm = ix("acq_time");
    const out = []; for(let i = 1; i < L.length && out.length < 25000; i++){ const r = L[i].split(","); if(r.length < 4) continue;
      out.push({k:"fire", id:"f" + i, lat:+r[la], lon:+r[lo], frp:+r[fr] || 0, conf:r[cf], t:Date.parse(r[dt] + "T" + String(r[tm]).padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2") + "Z") || 0}) } return out },
  tle:txt => { if(!txt) return []; const L = txt.split(/\r?\n/).map(s => s.trimEnd()).filter(Boolean), out = [];
    for(let i = 0; i + 2 < L.length + 1; i += 3){ if(!L[i + 1] || !L[i + 2]) break; out.push({name:L[i].trim(), l1:L[i + 1], l2:L[i + 2]}) } return out },
  ac:j => { if(!j || !j.data) return []; const d = j.data;
    if(d.states) return d.states.filter(s => s[5] != null && s[6] != null && !s[8]).map(s => ({k:"ac", id:s[0], hex:s[0], cs:(s[1] || "").trim(), lon:s[5], lat:s[6], alt:s[7] != null ? s[7] * 3.28084 : null, gs:s[9] != null ? s[9] * 1.94384 : null, trk:s[10] || 0, sq:s[14], ctry:s[2], cat:s[17], mil:0}));
    return (d.ac || []).filter(a => a.lat != null && a.alt_baro !== "ground").map(a => ({k:"ac", id:a.hex, hex:a.hex, cs:(a.flight || "").trim(), lon:a.lon, lat:a.lat, alt:typeof a.alt_baro === "number" ? a.alt_baro : null, gs:a.gs, trk:a.track || 0, sq:a.squawk, type:a.t, reg:a.r, mil:(a.dbFlags & 1) ? 1 : 0})) },
  mil:d => (d && d.ac || []).filter(a => a.lat != null).map(a => ({k:"ac", id:a.hex, hex:a.hex, cs:(a.flight || "").trim(), lon:a.lon, lat:a.lat, alt:typeof a.alt_baro === "number" ? a.alt_baro : null, gs:a.gs, trk:a.track || 0, sq:a.squawk, type:a.t, reg:a.r, mil:1}))
};
const pt = (o, props) => ({type:"Feature", id:undefined, geometry:{type:"Point", coordinates:[o.lon, o.lat]}, properties:props});
const fc = f => ({type:"FeatureCollection", features:f});

/* ---------- screen ---------- */
const ICO = {
  ac:'<path d="M10.5 3.5l1.5-1 1.5 1V9l7 4v2l-7-2v5l2 1.5V21l-3.5-1-3.5 1v-1.5l2-1.5v-5l-7 2v-2l7-4z"/>',
  sat:'<path d="M4 14l6-6M14 4l6 6-4 4-6-6zM8 10l6 6-4 4-6-6z"/><path d="M15 15l4 4"/>',
  quake:'<path d="M2 12h4l2-5 3 10 3-8 2 3h6"/>', fire:'<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-7 1 1 2 2 3-3z"/>',
  dis:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', rain:'<path d="M7 16a5 5 0 01-.5-9.9A6 6 0 0118 8a4 4 0 01-1 8"/><path d="M9 19l1-2M13 20l1-2"/>',
  ship:'<path d="M3 15h18M5 15l2 4h10l2-4M12 15V4l6 7h-6"/>', cam:'<rect x="3" y="7" width="13" height="10" rx="1"/><path d="M16 10l5-3v10l-5-3"/>',
  feed:'<path d="M4 6h16M4 12h10M4 18h13"/>', search:'<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', recon:'<path d="M4 17l6-6-6-6M12 19h8"/>',
  north:'<circle cx="12" cy="12" r="9"/><path d="M12 6l2.5 6L12 18l-2.5-6z"/>', loc:'<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  save:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', alert:'<path d="M12 3l9 16H3z"/><path d="M12 10v4"/>', x:'<path d="M6 6l12 12M18 6L6 18"/>', radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
const RAIL = [["ac", "Aircraft"], ["sat", "Satellites"], ["quake", "Earthquakes"], ["fire", "Fires"], ["dis", "Disasters and events"], ["rain", "Rain radar"], ["ship", "Ships"], ["cam", "Public cameras"]];

let S = null;   // the open screen's state
export async function openOsint(){
  if(S) return; const css = document.getElementById("oscss");
  if(!css){ const l = document.createElement("link"); l.id = "oscss"; l.rel = "stylesheet"; l.href = new URL("./osint.css?b=95", import.meta.url).href; document.head.appendChild(l) }
  const el = document.createElement("div"); el.id = "osint"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "OSINT");
  el.innerHTML = `<div class="os-map"></div><div class="os-top"><div class="os-brand">${svg("radar")}<div><b>OSINT</b><small>PAY TRACKER · OPEN SOURCE INTEL</small></div>
    <button class="os-x" data-os="close" aria-label="Close OSINT">${svg("x")}</button></div>
    <div class="os-stat"><span>ZULU <i data-os-z></i></span><span>STATUS <em data-os-live></em></span><span>TRACKED <u data-os-n>0</u></span><span>SOLAR <em data-os-kp>Kp ?</em></span></div></div>
    <div class="os-rail">${RAIL.map(([k, l]) => `<button data-os-l="${k}" aria-label="${l}" aria-pressed="false">${svg(k)}<em hidden></em></button>`).join("")}
    <hr><button data-os="feed" aria-label="Live feed">${svg("feed")}</button><button data-os="search" aria-label="Search">${svg("search")}</button><button data-os="recon" aria-label="Recon">${svg("recon")}</button></div>
    <div class="os-rr"><button data-os="north" aria-label="North up">${svg("north")}</button><button data-os="loc" aria-label="My location">${svg("loc")}</button>
    <button data-os="save" aria-label="Save this area for offline">${svg("save")}</button><button data-os="alerts" aria-label="Space weather alerts" class="os-red">${svg("alert")}</button></div>
    <div class="os-pills"><button data-os-p="globe">◎ 3D</button><button data-os-p="mercator">▢ 2D</button><button data-os-v="map">MAP</button><button data-os-v="sat">SAT</button></div>
    <div class="os-card" hidden></div><div class="os-panel" hidden></div><div class="os-toast" hidden></div>
    <div class="os-tick"><div class="os-tickin"></div></div>`;
  document.body.appendChild(el); document.documentElement.classList.add("sheet-open");
  S = {el, map:null, data:{}, at:{}, ac:[], acAt:0, mil:[], sats:[], sel:null, timers:[], follow:false};
  requestAnimationFrame(() => el.classList.add("on"));
  el.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  tickClock(); S.timers.push(setInterval(tickClock, 1000));
  paintRail(); paintPills();
  await loadAll(false);
  try{ await startMap() }catch(e){ toast("Map could not start: " + (e.message || e)) }
  S && S.timers.push(setInterval(() => loadAll(false), MIN), setInterval(loadAircraft, 20000), setInterval(deadReckon, 1000), setInterval(trackPoll, 5000), setInterval(moveSats, 2000), setInterval(loadShips, 90000));
  addEventListener("online", onOnline); addEventListener("offline", paintStatus);
}
function onOnline(){ runQueue(); if(S){ loadAll(true); loadAircraft(); loadShips() } }
function onKey(e){ if(e.key === "Escape" && S) closeOsint() }
export function closeOsint(){
  if(!S) return; const s = S; S = null;
  s.timers.forEach(clearInterval); removeEventListener("online", onOnline); removeEventListener("offline", paintStatus); document.removeEventListener("keydown", onKey);
  s.el.classList.remove("on"); document.documentElement.classList.remove("sheet-open");
  setTimeout(() => { try{ s.map && s.map.remove() }catch(e){} s.el.remove() }, RM() ? 0 : 380);
}

/* ---------- data into the screen ---------- */
async function loadAll(force){
  if(!S) return;
  const ks = ["quakes", "disasters", "events", "fires", "kp", "flares", "alerts", "tle", "stations"];
  if(prefs.on.rain) ks.push("rain");
  await Promise.all(ks.map(async k => { const r = await getFeed(k, force); if(!S) return; S.at[k] = r.at; S.live = S.live || {}; S.live[k] = r.live;
    if(k === "tle" || k === "stations"){ S.data[k] = P.tle(r.data) } else if(P[k]) S.data[k] = P[k](r.data); else S.data[k] = r.data }));
  if(!S) return;
  S.mil = S.data.mil || [];
  if(navigator.onLine !== false && (!S.milAt || Date.now() - S.milAt > MIN)) for(const u of ["https://api.adsb.lol/v2/mil", "https://api.airplanes.live/v2/mil", "https://opendata.adsb.fi/api/v2/mil"]){
    try{ const r = await fetch(u, {signal:AbortSignal.timeout(9000)}); if(!r.ok) continue; const m = P.mil(await r.json()); if(m.length && S){ S.mil = m; S.milAt = Date.now(); break } }catch(e){} }
  buildSats(); paintData(); paintStatus(); paintTicker();
  if(!S.acAt) loadAircraft();
}
async function loadAircraft(){
  if(!S || !S.map || !prefs.on.ac) return;
  if(navigator.onLine === false){ paintAircraft(); return }
  const b = S.map.getBounds(), z = S.map.getZoom(); if(z < 3.2){ paintAircraft(); toastOnce("zoom", "Zoom in for fresh civil traffic; military aircraft show worldwide"); return }
  if(S.acBusy || Date.now() - (S.acTry || 0) < 8000){ clearTimeout(S.acLater); S.acLater = setTimeout(loadAircraft, 8000); return }
  S.acBusy = true; S.acTry = Date.now();
  const la0 = Math.max(-85, b.getSouth()), la1 = Math.min(85, b.getNorth()), lo0 = Math.max(-180, b.getWest()), lo1 = Math.min(180, b.getEast());
  const q = `lamin=${la0.toFixed(1)}&lamax=${la1.toFixed(1)}&lomin=${lo0.toFixed(1)}&lomax=${lo1.toFixed(1)}`, c = S.map.getCenter();
  const dist = Math.max(25, Math.min(250, Math.round(Math.max(la1 - la0, (lo1 - lo0) * Math.cos(c.lat * Math.PI / 180)) * 30))), la = c.lat.toFixed(2), lo = c.lng.toFixed(2);
  // build 94: the phone asks the aircraft feeds itself (they refuse Cloudflare's servers); the relay is the last resort
  const SRC = [["adsblol", `https://api.adsb.lol/v2/point/${la}/${lo}/${dist}`], ["opensky", `https://opensky-network.org/api/states/all?${q}`],
    ["airplaneslive", `https://api.airplanes.live/v2/point/${la}/${lo}/${dist}`], ["adsbfi", `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${dist}`], ["relay", `${RELAY}/flights?${q}`]];
  const order = S.acSrc ? [...SRC.filter(x => x[0] === S.acSrc), ...SRC.filter(x => x[0] !== S.acSrc)] : SRC;
  for(const [n, u] of order){
    try{ const r = await fetch(u, {signal:AbortSignal.timeout(9000)}); if(!r.ok) continue; let j = await r.json(); if(n !== "relay") j = {src:n, data:j};
      const list = P.ac(j); if(!list.length && n !== order[order.length - 1][0]) continue; if(!S) return;
      mergeAc(list, Date.now()); S.acSrc = n; S.acAt = Date.now();
      try{ (await caches.open(OC)).put(RELAY + "/flights-last", new Response(JSON.stringify({j, at:S.acAt}))) }catch(e){}
      break }catch(e){} }
  S && (S.acBusy = false); paintAircraft();
}
async function lastAircraft(){ try{ const h = await (await caches.open(OC)).match(RELAY + "/flights-last"); if(h){ const o = await h.json(); mergeAc(P.ac(o.j), o.at); S.acAt = o.at } }catch(e){} }
// aircraft are kept by id: a failed or partial request no longer wipes them; unseen for 90 s, they go
function mergeAc(list, at){ S.acMap = S.acMap || new Map(); for(const a of list){ const o = S.acMap.get(a.id); S.acMap.set(a.id, Object.assign(o || {}, a, {fx:a.lon, fy:a.lat, fixAt:at})) }
  for(const [k, a] of S.acMap) if(Date.now() - a.fixAt > 90e3 && !(S.sel && S.sel.id === k)) S.acMap.delete(k);
  S.ac = [...S.acMap.values()] }
// between updates each aircraft moves along its track at its ground speed (up to 60 s past the last fix)
function deadReckon(){
  if(!S || !S.map || !prefs.on.ac) return; const now = Date.now();
  for(const a of [...(S.ac || []), ...(S.mil || [])]){ if(a.fx == null){ a.fx = a.lon; a.fy = a.lat; a.fixAt = a.fixAt || now }
    const dt = Math.min(60, (now - a.fixAt) / 1000); if(!a.gs || dt <= 0) continue;
    const d = a.gs * dt / 3600 / 60, r = (a.trk || 0) * Math.PI / 180; a.lat = a.fy + d * Math.cos(r); a.lon = a.fx + d * Math.sin(r) / Math.max(.2, Math.cos(a.fy * Math.PI / 180)) }
  paintAircraft(true);
}
// the tracked aircraft gets its own fresh position every 5 s
async function trackPoll(){
  if(!S || !S.follow || !S.sel || S.sel.k !== "ac" || navigator.onLine === false) return; const h = S.sel.hex;
  for(const u of [`https://api.adsb.lol/v2/hex/${h}`, `https://api.airplanes.live/v2/hex/${h}`, `https://opendata.adsb.fi/api/v2/hex/${h}`]){
    try{ const r = await fetch(u, {signal:AbortSignal.timeout(6000)}); if(!r.ok) continue; const a = P.mil(await r.json())[0]; if(!a || !S || !S.sel || S.sel.hex !== h) continue;
      a.mil = S.sel.mil; const now = Date.now(); Object.assign(S.sel, a, {fx:a.lon, fy:a.lat, fixAt:now}); if(S.acMap && S.acMap.has(S.sel.id)) S.acMap.set(S.sel.id, S.sel); break }catch(e){} }
}

/* ships: AIS positions for the view (zoom 4 and closer), last copy kept for offline */
const shipCls = t => t >= 70 && t < 80 ? "cargo" : t >= 80 && t < 90 ? "tanker" : t >= 60 && t < 70 ? "pass" : t === 30 ? "fish" : "other";
const SHIPT = {cargo:"CARGO", tanker:"TANKER", pass:"PASSENGER", fish:"FISHING", other:"VESSEL"};
async function loadShips(){
  if(!S || !S.map || !prefs.on.ship) { if(S) paintShips(); return }
  if(navigator.onLine !== false && S.map.getZoom() >= 4){ const b = S.map.getBounds();
    const q = `lamin=${b.getSouth().toFixed(1)}&lamax=${b.getNorth().toFixed(1)}&lomin=${b.getWest().toFixed(1)}&lomax=${b.getEast().toFixed(1)}`;
    try{ const r = await fetch(`${RELAY}/ships?${q}`); if(r.ok){ const j = await r.json(); if(!S) return; S.ships = j.map(x => ({k:"ship", ...x})); S.shipAt = Date.now();
      try{ (await caches.open(OC)).put(RELAY + "/ships-last", new Response(JSON.stringify({j:S.ships, at:S.shipAt}))) }catch(e){} } }catch(e){} }
  else if(navigator.onLine !== false) toastOnce("ships", "Zoom in to see ships");
  if(!S.ships){ try{ const h = await (await caches.open(OC)).match(RELAY + "/ships-last"); if(h){ const o = await h.json(); S.ships = o.j; S.shipAt = o.at } }catch(e){} }
  paintShips();
}
function paintShips(){ if(!S) return; setSrc("os-ship", prefs.on.ship ? (S.ships || []).map(x => pt(x, {id:String(x.id), cog:x.hdg != null && x.hdg < 360 ? x.hdg : x.cog || 0, cls:shipCls(x.type)})) : []); paintRail() }
/* public cameras: the list ships with the app (cameras.json, from OSIRIS's public camera lists), so it works offline */
async function loadCams(){
  if(!S.cams){ try{ const r = await fetch(new URL("./cameras.json?b=95", import.meta.url)); const a = await r.json(); if(!S) return;
    S.cams = a.map(c => ({k:"cam", lat:c[0], lon:c[1], name:c[2], city:c[3], ctry:c[4], img:c[5], stream:c[6], st:c[7], ext:c[8], src:c[9]})) }catch(e){ S.cams = [] } }
  setSrc("os-cam", prefs.on.cam ? S.cams.map((c, i) => pt(c, {i})) : []); paintRail();
}
const camImg = u => u.startsWith("P") ? RELAY + "/img?url=" + encodeURIComponent(u.slice(1)) : u;

/* satellites: positions from saved orbits, so they keep moving offline */
function buildSats(){
  const sl = window.satellite; if(!sl) return;
  const seen = new Set(), list = [];
  for(const t of [...(S.data.stations || []).slice(0, 12), ...(S.data.tle || [])]){ if(seen.has(t.l1.slice(2, 7))) continue; seen.add(t.l1.slice(2, 7));
    try{ list.push({name:t.name, id:t.l1.slice(2, 7), rec:sl.twoline2satrec(t.l1, t.l2)}) }catch(e){} }
  S.sats = list; moveSats();
}
function satAt(rec, d){ const sl = window.satellite, pv = sl.propagate(rec, d); if(!pv || !pv.position) return null; const g = sl.eciToGeodetic(pv.position, sl.gstime(d));
  const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0; return {lon:sl.degreesLong(g.longitude), lat:sl.degreesLat(g.latitude), alt:g.height, v} }
function moveSats(){
  if(!S || !S.map || !S.map.getSource("os-sat") || !window.satellite) return; const d = new Date(), f = [];
  for(const s of S.sats){ const p = satAt(s.rec, d); if(!p || !isFinite(p.lon)) continue; s.p = p; f.push(pt(p, {id:s.id, name:s.name, iss:/ISS|ZARYA/.test(s.name) ? 1 : 0})) }
  S.map.getSource("os-sat").setData(fc(prefs.on.sat ? f : []));
  if(S.sel && S.sel.k === "sat") paintCard();
}
function orbitOf(s){ const out = [], d0 = Date.now(); let seg = [];
  for(let m = -45; m <= 95; m += 1){ const p = satAt(s.rec, new Date(d0 + m * MIN)); if(!p) continue; if(seg.length && Math.abs(p.lon - seg[seg.length - 1][0]) > 180){ out.push(seg); seg = [] } seg.push([p.lon, p.lat]) }
  out.push(seg); return {type:"Feature", geometry:{type:"MultiLineString", coordinates:out}, properties:{}} }

/* ---------- map ---------- */
async function startMap(){
  const B = await import("./brief.js?b=95"), ml = await B.loadLib();
  if(!window.satellite) await new Promise(res => { const s = document.createElement("script"); s.src = new URL("./vendor/satellite/satellite.min.js", import.meta.url).href; s.onload = res; s.onerror = res; document.head.appendChild(s) });
  if(!S) return; buildSats();
  let style;
  try{ const raw = await (await B.cget(B.STYLES.dark, true)).text(); style = JSON.parse(B.toP(raw)) }
  catch(e){ const g = await import("./globedata.js"); const rings = g.WORLD.split("|").map(r => r.trim().split(" ").map(p => p.split(",").map(Number)));
    style = {version:8, sources:{land:{type:"geojson", data:{type:"Feature", geometry:{type:"MultiPolygon", coordinates:rings.map(r => [r])}, properties:{}}}},
      layers:[{id:"bg", type:"background", paint:{"background-color":"#04040A"}}, {id:"land", type:"fill", source:"land", paint:{"fill-color":"#0E1220", "fill-outline-color":"rgba(212,175,55,.35)"}}]};
    toast("Offline: coastlines only here. Save an area with signal for the full map") }
  style.projection = {type:prefs.proj};
  style.sources.os_sat = {type:"raster", tiles:["ptc://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize:256, maxzoom:17, attribution:"Imagery Esri"};
  style.layers.splice(1, 0, {id:"os-satimg", type:"raster", source:"os_sat", layout:{visibility:prefs.look === "sat" ? "visible" : "none"}});
  const map = new ml.Map({container:S.el.querySelector(".os-map"), style, center:[80, 20], zoom:3.4, pitch:0, attributionControl:{compact:true}, maxPitch:70});
  S.map = map;
  await new Promise(r => map.once("load", r)); if(!S) return;
  addImages(map); addLayers(map);
  if(!S.acAt) await lastAircraft();
  paintData(); paintAircraft(); moveSats(); loadAircraft();
  map.on("moveend", () => { clearTimeout(S && S.mv); if(S) S.mv = setTimeout(() => { loadAircraft(); loadShips() }, 600) });
  loadCams(); loadShips();
  map.on("click", e => { const f = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], {layers:["os-ac", "os-ship", "os-cam", "os-sat", "os-quake", "os-gdacs", "os-eonet", "os-fire"].filter(l => map.getLayer(l))})[0];
    if(!f){ select(null); return } select(pick(f)) });
  map.on("dragstart", () => { if(S && S.follow){ S.follow = false; paintCard(); toast("Tracking stopped") } });
  window.__os = {map, S, select, getFeed};   // for the tests
}
function addImages(map){
  const c = document.createElement("canvas"), n = 48; c.width = c.height = n; const g = c.getContext("2d"); g.translate(n / 2, n / 2); g.scale(n / 24, n / 24); g.translate(-12, -12);
  g.fillStyle = "#fff"; g.fill(new Path2D("M10.5 3.5l1.5-1 1.5 1V9l7 4v2l-7-2v5l2 1.5V21l-3.5-1-3.5 1v-1.5l2-1.5v-5l-7 2v-2l7-4z"));
  map.addImage("os-plane", g.getImageData(0, 0, n, n), {sdf:true, pixelRatio:2});
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n); g.beginPath(); g.moveTo(24, 6); g.lineTo(33, 40); g.lineTo(24, 34); g.lineTo(15, 40); g.closePath(); g.fill();
  map.addImage("os-ship", g.getImageData(0, 0, n, n), {sdf:true, pixelRatio:2});
}
function addLayers(map){
  const src = id => map.addSource(id, {type:"geojson", data:fc([])});
  ["os-fire", "os-quake", "os-gdacs", "os-eonet", "os-cam", "os-ship", "os-orbit", "os-sat", "os-ac", "os-selp"].forEach(src);
  map.addLayer({id:"os-fire", type:"circle", source:"os-fire", paint:{"circle-radius":["interpolate", ["linear"], ["zoom"], 2, 1.2, 8, 3.5], "circle-color":["case", [">", ["get", "frp"], 50], "#FF3D3D", "#FF7A2F"], "circle-opacity":.85}});
  map.addLayer({id:"os-quake-r", type:"circle", source:"os-quake", paint:{"circle-radius":["*", ["get", "mag"], 3.2], "circle-color":"transparent", "circle-stroke-color":"#FF9500", "circle-stroke-width":1, "circle-stroke-opacity":.6}});
  map.addLayer({id:"os-quake", type:"circle", source:"os-quake", paint:{"circle-radius":["*", ["get", "mag"], 1.5], "circle-color":"rgba(255,149,0,.35)", "circle-stroke-color":"#FF9500", "circle-stroke-width":1.2}});
  map.addLayer({id:"os-gdacs", type:"circle", source:"os-gdacs", paint:{"circle-radius":6, "circle-color":"transparent", "circle-stroke-width":2,
    "circle-stroke-color":["match", ["get", "level"], "Red", "#FF3D3D", "Orange", "#FF9500", "#00E676"]}});
  map.addLayer({id:"os-eonet", type:"circle", source:"os-eonet", paint:{"circle-radius":4.5, "circle-color":"#E040FB", "circle-stroke-color":"#04040A", "circle-stroke-width":1}});
  map.addLayer({id:"os-cam", type:"circle", source:"os-cam", paint:{"circle-radius":4, "circle-color":"#04040A", "circle-stroke-color":"#00E676", "circle-stroke-width":1.6}});
  map.addLayer({id:"os-ship", type:"symbol", source:"os-ship", layout:{"icon-image":"os-ship", "icon-size":["interpolate", ["linear"], ["zoom"], 4, .45, 10, .8], "icon-rotate":["get", "cog"], "icon-rotation-alignment":"map", "icon-allow-overlap":true},
    paint:{"icon-color":["match", ["get", "cls"], "cargo", "#7CFC9A", "tanker", "#FF6B6B", "pass", "#448AFF", "fish", "#FFD700", "#9FB0C4"]}});
  map.addLayer({id:"os-orbit", type:"line", source:"os-orbit", paint:{"line-color":"#00E676", "line-width":1, "line-dasharray":[2, 3], "line-opacity":.7}});
  map.addLayer({id:"os-sat", type:"circle", source:"os-sat", paint:{"circle-radius":["case", ["==", ["get", "iss"], 1], 5, 2.6], "circle-color":"#00E676", "circle-stroke-color":"#04040A", "circle-stroke-width":.8}});
  map.addLayer({id:"os-sat-l", type:"symbol", source:"os-sat", filter:["==", ["get", "iss"], 1], layout:{"text-field":["get", "name"], "text-size":10, "text-offset":[0, 1.2], "text-font":["Noto Sans Regular"]}, paint:{"text-color":"#00E676", "text-halo-color":"#04040A", "text-halo-width":1}});
  map.addLayer({id:"os-ac", type:"symbol", source:"os-ac", layout:{"icon-image":"os-plane", "icon-size":["interpolate", ["linear"], ["zoom"], 3, .5, 9, .9], "icon-rotate":["get", "trk"], "icon-rotation-alignment":"map", "icon-allow-overlap":true, "icon-ignore-placement":true},
    paint:{"icon-color":["case", ["==", ["get", "mil"], 1], "#FF3D3D", ["==", ["get", "emg"], 1], "#FFD700", "#00E5FF"], "icon-opacity":["case", ["==", ["get", "old"], 1], .35, .95]}});
  map.addLayer({id:"os-selp", type:"circle", source:"os-selp", paint:{"circle-radius":13, "circle-color":"transparent", "circle-stroke-color":"#D4AF37", "circle-stroke-width":1.5}});
  if(prefs.on.rain) addRain();
}
async function addRain(){
  const m = S && S.map; if(!m || m.getLayer("os-rain")) return;
  const r = await getFeed("rain"); if(!S || !r.data || !r.data.radar || !r.live){ if(S) toast("Rain radar needs signal"); return }
  const fr = r.data.radar.past.slice(-1)[0]; if(!fr) return;
  m.addSource("os-rain", {type:"raster", tiles:[r.data.host + fr.path + "/256/{z}/{x}/{y}/2/1_1.png"], tileSize:256, maxzoom:7, attribution:"RainViewer"});
  m.addLayer({id:"os-rain", type:"raster", source:"os-rain", paint:{"raster-opacity":.6}}, "os-fire");
}
function pick(f){ const p = f.properties, L = f.layer.id;
  if(L === "os-ac") return [...S.ac, ...S.mil].find(a => a.id === p.id) || null;
  if(L === "os-ship") return (S.ships || []).find(a => String(a.id) === String(p.id)) || null;
  if(L === "os-cam") return (S.cams || [])[p.i] || null;
  if(L === "os-sat"){ const s = S.sats.find(x => x.id === p.id); return s ? {k:"sat", id:s.id, s} : null }
  if(L === "os-quake") return (S.data.quakes || []).find(q => q.id === p.id);
  if(L === "os-gdacs") return (S.data.disasters || []).find(q => q.id === p.id);
  if(L === "os-eonet") return (S.data.events || []).find(q => q.id === p.id);
  if(L === "os-fire") return (S.data.fires || []).find(q => q.id === p.id);
  return null }

/* ---------- painting ---------- */
function setSrc(id, f){ const s = S.map && S.map.getSource(id); if(s) s.setData(fc(f)) }
function paintData(){
  if(!S) return; const on = prefs.on;
  setSrc("os-quake", on.quake ? (S.data.quakes || []).map(q => pt(q, {id:q.id, mag:Math.max(1, q.mag || 1)})) : []);
  setSrc("os-fire", on.fire ? (S.data.fires || []).map(q => pt(q, {id:q.id, frp:q.frp})) : []);
  setSrc("os-gdacs", on.dis ? (S.data.disasters || []).map(q => pt(q, {id:q.id, level:q.level})) : []);
  setSrc("os-eonet", on.dis ? (S.data.events || []).map(q => pt(q, {id:q.id})) : []);
  paintRail(); paintStatus();
}
function paintAircraft(tick){
  if(!S) return; const old = Date.now() - S.acAt > 2 * MIN, gone = Date.now() - S.acAt > 10 * MIN;
  const seen = new Set(S.mil.map(a => a.id)), list = [...(gone ? [] : S.ac.filter(a => !seen.has(a.id))), ...S.mil];
  S.acShown = list.length;
  setSrc("os-ac", prefs.on.ac ? list.map(a => pt(a, {id:a.id, trk:a.trk || 0, mil:a.mil, emg:/^7[567]00$/.test(a.sq || "") ? 1 : 0, old:old ? 1 : 0})) : []);
  if(S.sel && S.sel.k === "ac"){ const n = list.find(a => a.id === S.sel.id) || S.sel; if(n !== S.sel) S.sel = Object.assign(S.sel, n);
    setSrc("os-selp", [pt(S.sel, {})]); if(S.follow) S.map.easeTo({center:[S.sel.lon, S.sel.lat], duration:tick ? 950 : 600, easing:t => t});
    if(!tick || Date.now() % 5000 < 1000) paintCard() }
  if(tick) return; paintRail(); paintStatus();
}
function counts(){ return {ship:(S.ships || []).length, cam:(S.cams || []).length, ac:S.acShown || 0, sat:S.sats.length, quake:(S.data.quakes || []).length, fire:(S.data.fires || []).length, dis:(S.data.disasters || []).length + (S.data.events || []).length} }
const short = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
function paintRail(){
  if(!S) return; const c = counts();
  S.el.querySelectorAll("[data-os-l]").forEach(b => { const k = b.dataset.osL, on = !!prefs.on[k]; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    const em = b.querySelector("em"); if(c[k] != null && on){ em.hidden = false; em.textContent = short(c[k]) } else em.hidden = true });
}
function paintPills(){ S.el.querySelectorAll("[data-os-p]").forEach(b => b.classList.toggle("on", b.dataset.osP === prefs.proj)); S.el.querySelectorAll("[data-os-v]").forEach(b => b.classList.toggle("on", b.dataset.osV === prefs.look)) }
function kpNow(){ const k = S.data.kp; if(!Array.isArray(k) || !k.length) return null; const l = k[k.length - 1]; return l.kp_index != null ? l.kp_index : l.estimated_kp }
function paintStatus(){
  if(!S) return; const off = navigator.onLine === false, live = Object.values(S.live || {}).filter(Boolean).length, c = counts();
  const lv = S.el.querySelector("[data-os-live]"); lv.textContent = off ? "OFFLINE" : "LIVE " + live; lv.className = off ? "os-off" : "";
  S.el.querySelector("[data-os-n]").textContent = (c.ac + c.sat).toLocaleString("en-US");
  const kp = kpNow(); S.el.querySelector("[data-os-kp]").textContent = kp == null ? "Kp ?" : "Kp" + Math.round(kp);
}
function tickClock(){ if(S) S.el.querySelector("[data-os-z]").textContent = zulu(Date.now()) }
function feedItems(){
  const it = [];
  for(const q of S.data.quakes || []) it.push({t:q.t, tag:"QUAKE", c:"#FF9500", txt:`M${(q.mag || 0).toFixed(1)} ${q.place || ""}`, o:q});
  for(const g of S.data.disasters || []) it.push({t:g.t, tag:"GDACS", c:g.level === "Red" ? "#FF3D3D" : g.level === "Orange" ? "#FF9500" : "#00E676", txt:g.title, o:g});
  for(const e of S.data.events || []) it.push({t:e.t, tag:"EONET", c:"#E040FB", txt:e.title, o:e});
  for(const a of S.data.alerts || []) it.push({t:Date.parse(a.issue_datetime + "Z") || 0, tag:"SPACE", c:"#B388FF", txt:String(a.message || "").split("\n").find(l => /^(ALERT|WARNING|WATCH|SUMMARY)/.test(l)) || "Space weather notice"});
  for(const a of [...S.ac, ...S.mil]) if(/^7[567]00$/.test(a.sq || "")) it.push({t:S.acAt, tag:"SQK " + a.sq, c:"#FFD700", txt:`${a.cs || a.hex} squawking ${a.sq}`, o:a});
  return it.filter(i => i.t).sort((a, b) => b.t - a.t);
}
function paintTicker(){
  if(!S) return; const it = feedItems().slice(0, 14), kp = kpNow();
  const html = it.map(i => `<span><b style="color:${i.c}">${esc(i.tag)}</b> ${esc(i.txt)}</span>`).join("") + (kp != null ? `<span><b style="color:#00E676">Kp ${Math.round(kp)}</b> geomagnetic</span>` : "");
  const box = S.el.querySelector(".os-tickin"); box.innerHTML = html ? html + html : `<span>No saved data yet. Open with signal once.</span>`; box.classList.toggle("run", !!html && !RM());
}

/* ---------- selection card ---------- */
function select(o){
  S.sel = o; S.follow = false;
  setSrc("os-selp", o && o.lon != null ? [pt(o, {})] : o && o.k === "sat" && o.s.p ? [pt(o.s.p, {})] : []);
  setSrc("os-orbit", o && o.k === "sat" ? [orbitOf(o.s)] : []);
  if(o && o.k === "ac") lookupAc(o);
  paintCard();
}
async function lookupAc(a){
  if(navigator.onLine === false) return;
  const get = async u => { try{ const r = await fetch(RELAY + u); return r.ok ? r.json() : null }catch(e){ return null } };
  const [ac, rt] = await Promise.all([a.hex ? get("/aircraft?hex=" + a.hex) : null, a.cs ? get("/route?callsign=" + encodeURIComponent(a.cs)) : null]);
  if(!S || !S.sel || S.sel.id !== a.id) return;
  const A = ac && ac.response && ac.response.aircraft, R = rt && rt.response && rt.response.flightroute;
  if(A){ a.type = a.type || A.icao_type; a.reg = a.reg || A.registration; a.owner = A.registered_owner }
  if(R){ a.from = (R.origin || {}).iata_code || (R.origin || {}).icao_code; a.to = (R.destination || {}).iata_code || (R.destination || {}).icao_code }
  paintCard();
}
const ll = (lat, lon) => `${Math.abs(lat).toFixed(1)}${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}${lon >= 0 ? "E" : "W"}`;
function paintCard(){
  const c = S.el.querySelector(".os-card"), o = S.sel; if(!o){ c.hidden = true; return }
  let head = "", title = "", sub = "", ico = "ac", grid = [], acts = "", link = "";
  if(o.k === "ac"){ head = `ADS-B · ${String(o.hex || "").toUpperCase()} · ${ll(o.lat, o.lon)}`; title = o.cs || String(o.hex).toUpperCase();
    sub = [o.type, o.reg, o.mil ? "MILITARY" : "CIVIL", S.acSrc && !o.mil ? "VIA " + S.acSrc.toUpperCase() : ""].filter(Boolean).join(" · ");
    grid = [["ALT", o.alt == null ? "—" : o.alt >= 10000 ? "FL" + Math.round(o.alt / 100) : Math.round(o.alt) + "ft"], ["GS", o.gs == null ? "—" : Math.round(o.gs) + "kt"], ["HDG", String(Math.round(o.trk || 0)).padStart(3, "0") + "°"], ["SQK", o.sq || "—"]];
    acts = `<button data-os="follow"${S.follow ? ' class="on"' : ""}>${S.follow ? "TRACKING" : "TRACK"}</button><span>${o.owner ? esc(o.owner) : Date.now() - S.acAt > 2 * MIN ? "SEEN " + ago(S.acAt) + " AGO" : "LIVE"}</span>` }
  else if(o.k === "sat"){ const p = o.s.p || {}; ico = "sat"; head = `NORAD ${o.s.id} · ${p.lat != null ? ll(p.lat, p.lon) : ""}`; title = o.s.name; sub = "SATELLITE · ORBIT FROM SAVED DATA";
    grid = [["ALT", p.alt ? Math.round(p.alt) + "km" : "—"], ["VEL", p.v ? p.v.toFixed(1) + "km/s" : "—"], ["LAT", p.lat != null ? p.lat.toFixed(1) : "—"], ["LON", p.lon != null ? p.lon.toFixed(1) : "—"]];
    acts = `<span>DASHED LINE: NEXT 95 MIN</span>` }
  else if(o.k === "ship"){ ico = "ship"; head = `AIS · MMSI ${o.id} · ${ll(o.lat, o.lon)}`; title = o.name || "MMSI " + o.id; sub = [SHIPT[shipCls(o.type)], o.call].filter(Boolean).join(" · ");
    grid = [["SOG", o.sog != null ? o.sog.toFixed(1) + "kt" : "—"], ["COG", o.cog != null ? Math.round(o.cog) + "°" : "—"], ["DEST", o.dest || "—"], ["SEEN", ago(Date.parse(o.t) || S.shipAt)]] }
  else if(o.k === "cam"){ ico = "cam"; head = `${o.src || "PUBLIC CAMERA"} · ${ll(o.lat, o.lon)}`; title = o.name; sub = [o.city, o.ctry].filter(Boolean).join(", "); link = o.ext;
    const off = navigator.onLine === false;
    S.camHtml = off ? `<p class="os-empty">Camera pictures need signal</p>` : o.stream && (o.st === "hls" || o.st === "mp4") ? `<video class="os-vid" src="${esc(o.stream)}" playsinline muted autoplay controls></video>`
      : o.stream && o.st === "iframe" ? `<iframe class="os-vid" src="${esc(o.stream)}" allow="autoplay" loading="lazy"></iframe>` : o.img ? `<img class="os-vid" src="${esc(camImg(o.img))}&t=${Date.now()}" alt="${esc(o.name)}">` : `<p class="os-empty">This camera opens on its own site</p>` }
  else if(o.k === "quake"){ ico = "quake"; head = `USGS · ${ll(o.lat, o.lon)}`; title = "M" + (o.mag || 0).toFixed(1) + " EARTHQUAKE"; sub = o.place || ""; grid = [["DEPTH", Math.round(o.dep || 0) + "km"], ["TIME", zulu(o.t).slice(0, 5) + "Z"], ["AGO", ago(o.t)], ["MAG", (o.mag || 0).toFixed(1)]]; link = o.url }
  else if(o.k === "fire"){ ico = "fire"; head = `NASA FIRMS · ${ll(o.lat, o.lon)}`; title = "ACTIVE FIRE"; sub = "Satellite hotspot"; grid = [["FRP", Math.round(o.frp) + "MW"], ["CONF", esc(o.conf || "—")], ["SEEN", o.t ? zulu(o.t).slice(0, 5) + "Z" : "—"], ["AGO", ago(o.t)]] }
  else if(o.k === "gdacs"){ ico = "dis"; head = `GDACS · ${o.level || ""} ALERT`; title = o.title; sub = o.country || ""; grid = [["TYPE", o.type || "—"], ["LEVEL", o.level || "—"], ["FROM", o.t ? new Date(o.t).toISOString().slice(5, 10) : "—"], ["AGO", ago(o.t)]]; link = o.url }
  else if(o.k === "eonet"){ ico = "dis"; head = `NASA EONET · ${ll(o.lat, o.lon)}`; title = o.title; sub = o.cat; grid = [["CAT", o.cat], ["SEEN", o.t ? new Date(o.t).toISOString().slice(5, 10) : "—"], ["AGO", ago(o.t)], ["", ""]]; link = o.url }
  const route = o.k === "ac" && (o.from || o.to) ? `<div class="os-route"><span>${esc(o.from || "?")}</span><div class="os-ln"></div><span>${esc(o.to || "?")}</span></div>` : "";
  c.innerHTML = `<div class="os-ch"><span>${esc(head)}</span><span>${zulu(Date.now()).slice(0, 5)}Z · ${navigator.onLine === false ? "OFFLINE" : "LIVE"}</span></div>
    <div class="os-ct"><div class="os-ic">${svg(ico)}</div><div><b>${esc(title)}</b><small>${esc(sub)}</small></div><button class="os-cx" data-os="unsel" aria-label="Close card">${svg("x")}</button></div>${route}
    ${o.k === "cam" ? S.camHtml : ""}<div class="os-grid"${grid.length ? "" : " hidden"}>${grid.map(([a, b]) => `<div><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join("")}</div>
    <div class="os-acts">${acts}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">SOURCE</a>` : ""}</div>`;
  c.hidden = false;
}

/* ---------- panels: feed, search, recon, alerts ---------- */
function panel(html){ const p = S.el.querySelector(".os-panel"); if(html == null){ p.hidden = true; return } p.innerHTML = `<div class="os-ph"><b></b><button data-os="pclose" aria-label="Close">${svg("x")}</button></div>` + html; p.hidden = false }
function showFeed(){
  const it = feedItems().slice(0, 80), age = Math.max(...["quakes", "disasters", "events"].map(k => S.at[k] || 0));
  panel(`<div class="os-pt">LIVE FEED · UPDATED ${ago(age).toUpperCase()}${navigator.onLine === false ? " · OFFLINE" : ""}</div>` + (it.length ? it.map((i, n) => `<button class="os-row" data-os-i="${n}"><b style="color:${i.c}">${esc(i.tag)}</b><span>${esc(i.txt)}</span><i>${ago(i.t)}</i></button>`).join("") : `<p class="os-empty">Nothing saved yet. Open OSINT once with signal.</p>`));
  S.feed = it;
}
function showSearch(){
  panel(`<div class="os-pt">SEARCH CALLSIGN, REG, HEX, SATELLITE OR PLACE</div><input class="os-in" type="search" placeholder="AIC101, VT-BWA, ISS" autocomplete="off" autocapitalize="characters"><div class="os-res"></div>`);
  const i = S.el.querySelector(".os-in"); i.focus();
  i.addEventListener("input", () => { const q = i.value.trim().toUpperCase(), res = S.el.querySelector(".os-res"); if(q.length < 2){ res.innerHTML = ""; return }
    const hits = [];
    for(const a of [...S.ac, ...S.mil]) if((a.cs || "").toUpperCase().includes(q) || (a.reg || "").toUpperCase().includes(q) || (a.hex || "").toUpperCase() === q) hits.push({o:a, tag:"AIR", txt:`${a.cs || a.hex} ${a.type || ""}`});
    for(const s of S.sats) if(s.name.toUpperCase().includes(q)) hits.push({o:{k:"sat", id:s.id, s}, tag:"SAT", txt:s.name});
    for(const q2 of S.data.quakes || []) if((q2.place || "").toUpperCase().includes(q)) hits.push({o:q2, tag:"QUAKE", txt:`M${(q2.mag || 0).toFixed(1)} ${q2.place}`});
    for(const e of [...(S.data.disasters || []), ...(S.data.events || [])]) if((e.title || "").toUpperCase().includes(q) || (e.country || "").toUpperCase().includes(q)) hits.push({o:e, tag:e.k === "gdacs" ? "GDACS" : "EONET", txt:e.title});
    S.hits = hits.slice(0, 40); res.innerHTML = S.hits.length ? S.hits.map((h, n) => `<button class="os-row" data-os-h="${n}"><b>${h.tag}</b><span>${esc(h.txt)}</span></button>`).join("") : `<p class="os-empty">No match in what is loaded</p>` });
}
function showAlerts(){
  const a = (S.data.alerts || []).slice(0, 12), f = S.data.flares, kp = kpNow(), fl = Array.isArray(f) && f.length ? f[f.length - 1] : null;
  panel(`<div class="os-pt">SPACE WEATHER · NOAA SWPC · ${ago(S.at.alerts).toUpperCase()}</div><div class="os-kv"><span>Kp <b>${kp == null ? "?" : kp.toFixed(1)}</b></span><span>LAST FLARE <b>${fl ? esc(fl.max_class || fl.current_class || "?") : "?"}</b></span></div>` +
    (a.length ? a.map(x => `<div class="os-msg"><i>${esc(String(x.issue_datetime || "").slice(0, 16))}Z</i><pre>${esc(String(x.message || "").split("\n").slice(0, 8).join("\n"))}</pre></div>`).join("") : `<p class="os-empty">No alerts saved</p>`));
}
function goTo(o){ if(!o) return; panel(null); const p = o.k === "sat" ? o.s.p : o; if(p && p.lon != null) S.map.flyTo({center:[p.lon, p.lat], zoom:Math.max(S.map.getZoom(), 5), duration:RM() ? 0 : 1400}); select(o) }

/* ---------- recon: passive lookups through my relay; offline they wait and run when signal returns ---------- */
const TOOLS = [["dns", "DNS", "example.com"], ["whois", "WHOIS", "example.com or 8.8.8.8"], ["ssl", "SSL", "example.com"], ["ip", "IP", "8.8.8.8"], ["cve", "CVE", "CVE-2024-3400 or keyword"],
  ["threat", "THREATS", "IP to check"], ["sdn", "SANCTIONS", "person, company, vessel"], ["wallet", "WALLET", "BTC or ETH address"]];
const QKEY = "pt.osint.queue", RKEY = "pt.osint.done";
const lsGet = (k, d) => { try{ return JSON.parse(localStorage.getItem(k) || "null") || d }catch(e){ return d } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
let rtool = "dns";
function showRecon(){
  const done = lsGet(RKEY, []), qd = lsGet(QKEY, []);
  panel(`<div class="os-pt">RECON TOOLKIT · PASSIVE LOOKUPS</div><div class="os-tools">${TOOLS.map(([k, l]) => `<button data-os-t="${k}"${k === rtool ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
    <div class="os-rq"><input class="os-in" placeholder="${esc(TOOLS.find(t => t[0] === rtool)[2])}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-os="rgo">RUN</button></div><div class="os-out"></div>` +
    (qd.length ? `<div class="os-pt">WAITING FOR SIGNAL</div>${qd.map(x => `<div class="os-row"><b>${esc(x.t.toUpperCase())}</b><span>${esc(x.v)}</span></div>`).join("")}` : "") +
    (done.length ? `<div class="os-pt">RAN WHEN SIGNAL CAME BACK</div>${done.slice(0, 6).map(x => `<div class="os-msg"><i>${esc(x.t.toUpperCase())} ${esc(x.v)}</i><pre>${esc(x.out)}</pre></div>`).join("")}` : ""));
  S.el.querySelector(".os-rq input").addEventListener("keydown", e => { if(e.key === "Enter") runRecon() });
}
async function runRecon(){
  const i = S.el.querySelector(".os-rq input"), v = i.value.trim(), out = S.el.querySelector(".os-out"); if(!v) return;
  const local = rtool === "sdn" || rtool === "threat";   // these search lists kept on the phone, so they work offline once downloaded
  if(navigator.onLine === false && !local){ const q = lsGet(QKEY, []); q.push({t:rtool, v}); lsSet(QKEY, q); out.innerHTML = `<p class="os-empty">Offline: saved. It runs by itself when signal returns.</p>`; return }
  out.innerHTML = `<p class="os-empty">Looking up…</p>`;
  const txt = await recon(rtool, v); if(S) out.innerHTML = `<pre class="os-pre">${esc(txt)}</pre>`;
}
async function rj(u){ const r = await fetch(RELAY + u); if(!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "HTTP " + r.status); return r.json() }
async function recon(t, v){
  try{
    if(t === "dns"){ const lines = []; for(const ty of ["A", "AAAA", "MX", "NS", "TXT", "CNAME"]){ const j = await rj(`/dns?name=${encodeURIComponent(v)}&type=${ty}`); for(const a of j.Answer || []) lines.push(`${ty.padEnd(6)}${a.data}`) } return lines.join("\n") || "No records" }
    if(t === "whois"){ const j = await rj(`/rdap?q=${encodeURIComponent(v)}`), ev = (j.events || []).map(e => `${e.eventAction}: ${String(e.eventDate).slice(0, 10)}`), ent = (j.entities || []).map(e => `${(e.roles || []).join("/")}: ${((e.vcardArray || [])[1] || []).find(x => x[0] === "fn")?.[3] || e.handle || ""}`);
      return [j.ldhName || j.name || j.handle, j.startAddress ? `${j.startAddress} - ${j.endAddress}` : "", j.country ? "Country: " + j.country : "", ...(j.status || []).map(s => "Status: " + s), ...ev, ...ent, ...(j.nameservers || []).map(n => "NS: " + n.ldhName)].filter(Boolean).join("\n") }
    if(t === "ssl"){ const j = await rj(`/certs?d=${encodeURIComponent(v)}`), seen = new Set();
      return j.slice(0, 40).filter(c => !seen.has(c.serial_number) && seen.add(c.serial_number)).map(c => `${String(c.not_before).slice(0, 10)} to ${String(c.not_after).slice(0, 10)}  ${c.common_name}\n  issuer: ${String(c.issuer_name).replace(/.*O=([^,]+).*/, "$1")}`).join("\n") || "No certificates found" }
    if(t === "ip"){ const j = await rj(`/ip?ip=${encodeURIComponent(v)}`), g = j.geo || {}, p = j.ports || {};
      return [`${g.ip || v}  ${[g.city, g.region, g.country].filter(Boolean).join(", ")}`, g.connection ? `ASN ${g.connection.asn} ${g.connection.org || g.connection.isp || ""}` : "", p.ports ? "Ports seen open: " + p.ports.join(", ") : "No open ports on record",
        p.hostnames && p.hostnames.length ? "Hostnames: " + p.hostnames.join(", ") : "", p.vulns && p.vulns.length ? "Known vulns: " + p.vulns.slice(0, 12).join(", ") : "", p.tags && p.tags.length ? "Tags: " + p.tags.join(", ") : ""].filter(Boolean).join("\n") }
    if(t === "cve"){ const id = /^cve-/i.test(v); const j = await rj(id ? `/cve?id=${encodeURIComponent(v)}` : `/cve?q=${encodeURIComponent(v)}`);
      const kev = (await getFeed("kev")).data, kv = new Set(((kev || {}).vulnerabilities || []).map(x => x.cveID));
      return (j.vulnerabilities || []).slice(0, 15).map(({cve:c}) => { const m = (c.metrics || {}), s = (m.cvssMetricV31 || m.cvssMetricV30 || m.cvssMetricV2 || [])[0];
        return `${c.id}${kv.has(c.id) ? "  [EXPLOITED: CISA KEV]" : ""}${s ? "  CVSS " + s.cvssData.baseScore : ""}\n  ${((c.descriptions || [])[0] || {}).value || ""}`.slice(0, 400) }).join("\n\n") || "Nothing found" }
    if(t === "threat"){ const r = await getFeed("feodo"); if(!r.data) return "Threat list not downloaded yet (needs signal once)"; const hit = r.data.filter(x => x.ip_address === v);
      return hit.length ? hit.map(x => `LISTED: ${x.ip_address}:${x.port} ${x.malware} (${x.status}), first seen ${x.first_seen}, ${x.country || ""}`).join("\n") : `${v} is not on the Feodo botnet list (${r.data.length} entries, updated ${ago(r.at)} ago)` }
    if(t === "sdn"){ const r = await getFeed("sdn"); if(!r.data) return "Sanctions list not downloaded yet (needs signal once, about a few MB)"; const q = v.toLowerCase(), L = r.data.split("\n"), out = [];
      for(let i = 1; i < L.length && out.length < 25; i++) if(L[i].toLowerCase().includes(q)){ const c = csvRow(L[i]); out.push(`${c[2]}  (${c[1]})${c[5] ? "  " + c[5] : ""}\n  ${String(c[8] || "").slice(0, 160)}`) }
      return (out.length ? out.join("\n") : "No match on the US OFAC SDN list") + `\nList from OpenSanctions, updated ${ago(r.at)} ago` }
    if(t === "wallet"){ const j = await rj(`/wallet?a=${encodeURIComponent(v)}`);
      if(j.chain_stats){ const c = j.chain_stats, m = j.mempool_stats || {}; return `BTC ${j.address}\nBalance: ${((c.funded_txo_sum - c.spent_txo_sum) / 1e8).toFixed(8)} BTC\nTransactions: ${c.tx_count}${m.tx_count ? " (+" + m.tx_count + " pending)" : ""}\nReceived: ${(c.funded_txo_sum / 1e8).toFixed(8)} BTC` }
      return `ETH ${j.hash}\nBalance: ${(Number(j.coin_balance || 0) / 1e18).toFixed(6)} ETH\n${j.is_contract ? "Contract" : "Wallet"}${j.name ? "  " + j.name : ""}${j.ens_domain_name ? "\nENS: " + j.ens_domain_name : ""}` }
  }catch(e){ return "Lookup failed: " + (e.message || e) }
  return "";
}
function csvRow(l){ const out = []; let cur = "", q = false; for(let i = 0; i < l.length; i++){ const ch = l[i]; if(q){ if(ch === '"'){ if(l[i + 1] === '"'){ cur += '"'; i++ } else q = false } else cur += ch } else if(ch === '"') q = true; else if(ch === ","){ out.push(cur); cur = "" } else cur += ch } out.push(cur); return out }
export async function runQueue(){
  const q = lsGet(QKEY, []); if(!q.length || navigator.onLine === false) return; lsSet(QKEY, []);
  const done = lsGet(RKEY, []); for(const x of q) done.unshift({...x, out:await recon(x.t, x.v), at:Date.now()}); lsSet(RKEY, done.slice(0, 20));
}

/* ---------- save an area for offline: map tiles for the view, a few zooms deeper ---------- */
async function saveArea(){
  if(navigator.onLine === false){ toast("Saving needs signal"); return }
  const B = await import("./brief.js?b=95"), m = S.map, b = m.getBounds(), z0 = Math.max(2, Math.floor(m.getZoom()));
  let tpl; try{ const tj = await (await B.cget(B.HOST + "/planet", true)).json(); tpl = tj.tiles[0] }catch(e){ toast("Could not reach the map server"); return }
  const t2 = (lon, lat, z) => { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))] };
  const list = []; for(let z = z0; z <= Math.min(14, z0 + 3) && list.length < 1500; z++){ const [x0, y0] = t2(Math.max(-180, b.getWest()), Math.min(85, b.getNorth()), z), [x1, y1] = t2(Math.min(180, b.getEast()), Math.max(-85, b.getSouth()), z);
    for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++) if(list.length < 1500) list.push(tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y)) }
  let done = 0; toast(`Saving ${list.length} map tiles…`);
  for(let i = 0; i < list.length; i += 4){ await Promise.all(list.slice(i, i + 4).map(u => B.cget(u).then(() => done++).catch(() => {}))); if(!S) return; if(i % 40 === 0) toast(`Saving map tiles ${done} of ${list.length}`) }
  toast(`Saved ${done} tiles for offline`);
}

/* ---------- controls ---------- */
let tt = 0; function toast(m){ if(!S) return; const t = S.el.querySelector(".os-toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { if(S) t.hidden = true }, 3500) }
const once = new Set(); function toastOnce(k, m){ if(once.has(k)) return; once.add(k); toast(m) }
function onClick(e){
  const b = e.target.closest("button,[data-os-i],[data-os-h]"); if(!b || !S) return;
  const L = b.dataset.osL, a = b.dataset.os;
  if(L){ prefs.on[L] = !prefs.on[L]; savePrefs(); if(L === "ship") loadShips(); if(L === "cam") loadCams();
    if(L === "rain"){ if(prefs.on.rain) addRain(); else if(S.map && S.map.getLayer("os-rain")){ S.map.removeLayer("os-rain"); S.map.removeSource("os-rain") } }
    paintData(); paintAircraft(); moveSats(); if(L === "ac" && prefs.on.ac) loadAircraft(); return }
  if(b.dataset.osP){ prefs.proj = b.dataset.osP; savePrefs(); paintPills(); if(S.map) S.map.setProjection({type:prefs.proj}); return }
  if(b.dataset.osV){ prefs.look = b.dataset.osV; savePrefs(); paintPills(); if(S.map && S.map.getLayer("os-satimg")) S.map.setLayoutProperty("os-satimg", "visibility", prefs.look === "sat" ? "visible" : "none"); if(prefs.look === "sat" && navigator.onLine === false) toast("Satellite imagery shows only where you looked before"); return }
  if(b.dataset.osT){ rtool = b.dataset.osT; showRecon(); return }
  if(b.dataset.osI != null){ goTo((S.feed[+b.dataset.osI] || {}).o); return }
  if(b.dataset.osH != null){ goTo((S.hits[+b.dataset.osH] || {}).o); return }
  switch(a){
    case "close": closeOsint(); break;
    case "unsel": select(null); break;
    case "pclose": panel(null); break;
    case "feed": showFeed(); break;
    case "search": showSearch(); break;
    case "alerts": showAlerts(); break;
    case "recon": showRecon(); break;
    case "rgo": runRecon(); break;
    case "north": S.map && S.map.easeTo({bearing:0, pitch:0, duration:600}); break;
    case "loc": navigator.geolocation && navigator.geolocation.getCurrentPosition(p => S && S.map.flyTo({center:[p.coords.longitude, p.coords.latitude], zoom:7}), () => toast("Location not available")); break;
    case "save": saveArea(); break;
    case "follow": S.follow = !S.follow; paintCard(); if(S.follow && S.sel){ S.map.easeTo({center:[S.sel.lon, S.sel.lat], zoom:Math.max(7, S.map.getZoom())}); trackPoll() } break;
  }
}
