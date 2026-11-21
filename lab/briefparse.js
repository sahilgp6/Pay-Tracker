/* Briefing reader for the lab map. Takes the text lines of a briefing PDF and returns what the map needs:
   the planned route and its waypoints, cruise level, winds aloft per waypoint, NOTAMs (with shapes, levels and
   active times), airspace activation tables, and airport weather. Runs on the phone; nothing leaves it.
   Page furniture (titles, page numbers, flight list) is skipped and never kept. */

const MON = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

const furniture = l =>
  /Page \d+\/\d+\s*$/.test(l) || /Trans ID:/.test(l) || /Creation Time:/.test(l) ||
  /^\d{1,3}\/\d{1,3}$/.test(l) || /^[A-Z]{2,3}\d{1,4}[A-Z]? \d{2}[A-Z]{3}\d{2} /.test(l);

export function clean(lines){
  return lines.map(l => l.replace(/\s+/g, " ").trim()).filter(l => !furniture(l));
}

// "05 NOV 2026" + "01:00" -> UTC ms
function utc(d, t){ const m = d.match(/(\d{2}) ([A-Z]{3}) (\d{4})/); if(!m || !(m[2] in MON)) return null;
  const [h, mi] = t.split(":").map(Number); return Date.UTC(+m[3], MON[m[2]], +m[1], h, mi) }

// level text to feet: SFC/GND 0, FL370 37000, 7000FT AMSL 7000, UNL very high
export function feet(s){ s = (s || "").toUpperCase().trim(); if(!s) return null;
  if(/^(SFC|GND)/.test(s)) return 0; if(/UNL/.test(s)) return 99999;
  let m = s.match(/FL\s?(\d{2,3})/); if(m) return +m[1] * 100;
  m = s.match(/(\d{2,5})\s?(FT|M)\b/); if(m) return m[2] === "M" ? Math.round(+m[1] * 3.281) : +m[1];
  return null }

// coordinates: 140622N 0742838E, 154241.50N0780939.40E (DDMMSS), N17144 E078257 (DDMM.m)
const CO = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EW])/g;
export function coords(text){ const out = []; let m; CO.lastIndex = 0;
  while((m = CO.exec(text))){ let lat = +m[1] + m[2] / 60 + m[3] / 3600, lon = +m[5] + m[6] / 60 + m[7] / 3600;
    if(m[4] === "S") lat = -lat; if(m[8] === "W") lon = -lon; if(lat <= 90 && lon <= 180) out.push([lon, lat]) }
  return out }

// daily or weekday windows: "0100-1230", "TUE THU SAT 0030-0430 1130-1730, MON WED FRI 0030-0930"
export function schedule(text){
  text = text.toUpperCase().replace(/\b(MON|TUES|WEDNES|THURS|FRI|SATUR|SUN)DAYS?\b/g, m => m.slice(0, 3));
  const out = []; let cur = {days:[], win:[]};
  for(const m of text.matchAll(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)\b|\b(\d{2})(\d{2})\s?-\s?(\d{2})(\d{2})\b/g)){
    if(m[1]){ if(cur.win.length){ out.push(cur); cur = {days:[], win:[]} } cur.days.push(DAYS.indexOf(m[1])) }
    else { const a = +m[2] * 60 + +m[3], b = +m[4] * 60 + +m[5]; if(a < 1440 && b <= 1440) cur.win.push([a, b]) } }
  if(cur.win.length) out.push(cur);
  out.forEach(p => { if(!p.days.length) p.days = null });
  return out.length ? out : null }

export function activeAt(n, t){
  if(n.from != null && t < n.from) return false; if(n.to != null && t > n.to) return false;
  if(!n.sched) return true;
  const d = new Date(t), mins = d.getUTCHours() * 60 + d.getUTCMinutes(), day = d.getUTCDay();
  return n.sched.some(s => {
    return s.win.some(([a, b]) => {
      if(a <= b) return (!s.days || s.days.includes(day)) && mins >= a && mins <= b;
      // across midnight: the evening part belongs to the listed day, the early part to the next
      return (mins >= a && (!s.days || s.days.includes(day))) || (mins <= b && (!s.days || s.days.includes((day + 6) % 7)));
    }) }) }

function kindOf(t){
  if(/DANGER|FIRING|MISSILE|ROCKET|LIVE FIRE|GUNNERY/.test(t)) return "dng";
  if(/PROHIBITED|RESTRICTED|\bTRA\b|\bTSA\b|MIL(ITARY)?\b|AIRSPACE RESERV/.test(t)) return "tra";
  if(/DRONE|\bUAS\b|RPAS|\bUAV\b|OBST|CRANE|BALLOON|KITE|FIREWORK|LASER|TOWER|CHIMNEY/.test(t)) return "obs";
  if(/SURVEY|PHOTOGRAPH|GEOPHYSICAL|AERIAL WORK/.test(t)) return "svy";
  return "oth" }

// airport NOTAM type, with the runway / taxiways / aid it is about
export function adKind(t){
  let m = t.match(/\bRWY\s?(\d{2}[LRC]?)(?:\s?\/\s?(\d{2}[LRC]?))?\b[^.]{0,60}?\b(CLSD|CLOSED)\b/);
  if(m && !/\bTWY\b[^.]{0,12}\bCLSD/.test(t.slice(0, m.index + 6))) return {k:"rwy", rwy:[m[1], m[2]].filter(Boolean)};
  const sent = "(?:(?!\\. )[\\s\\S]){0,140}?";
  if(/\bTWY\b/.test(t) && /\b(CLSD|CLOSED|NOT AVBL)\b/.test(t) && !/\b(LGT|LIGHTS?|STOP BAR|SIGNS?|MARKINGS?|INDICATOR|GUIDANCE|CL LGT|PRKG|PARKING|ISOLATION)\b/.test(t)){
    const head = /\bBTN\b/.test(t) ? t.slice(0, t.search(/\bBTN\b/)) : t;
    const twy = [...new Set([...head.matchAll(/\bTWY ([A-Z]{1,2}\d{0,2})\b/g)].map(m => m[1]))];
    if(twy.length) return {k:"twy", twy} }
  m = t.match(new RegExp("\\b(ILS|LOC|LLZ|GP|GS|DME|DVOR|VOR|NDB|PAPI|ALS|APCH LGT|RWY LGT|EDGE LGT|CL LGT|TDZ LGT)\\b" + sent + "\\b(U\\/S|NOT AVBL|UNSERVICEABLE|OUT OF SERVICE|WITHDRAWN|OTS)\\b"));
  if(m){ const r = t.match(/\bRWY\s?(\d{2}[LRC]?)/); const aid = m[1];
    return {k: /LGT|PAPI|ALS/.test(aid) ? "lgt" : "aid", aid, rwy: r ? [r[1]] : []} }
  if(/\bRWY\b[^.]{0,40}\b(TORA|TODA|LDA|ASDA|DTHR|DISPLACED)\b/.test(t)) return {k:"dist"};
  if(/\bWIP\b|WORK IN PROGRESS|CONST/.test(t)) return {k:"wip"};
  return {k:"gen"} }

export function parseBriefing(rawLines){
  const L = clean(rawLines), B = {date:null, dep:null, dest:null, altn:[], route:[], fl:null, winds:{}, notams:[], aup:[], wx:{}, icao:{}, sects:[], std:null, sta:null, taxi:null};
  // date of the plan: a line holding only "10NOV26"
  for(const l of L){ const m = l.match(/^(\d{2})([A-Z]{3})(\d{2})$/); if(m && m[2] in MON){ B.date = Date.UTC(2000 + +m[3], MON[m[2]], +m[1]); break } }
  for(const l of L){ const m = l.match(/\bDEP ([A-Z]{4})\/([A-Z]{3})\b.*\bDEST ([A-Z]{4})\/([A-Z]{3})\b/); if(m){ B.dep = m[2]; B.dest = m[4]; B.icao[m[1]] = m[2]; B.icao[m[3]] = m[4]; break } }
  for(const l of L){ const m = l.match(/^-ALTN- ((?:[A-Z]{4}\s*)+)$/); if(m){ B.altnIcao = m[1].trim().split(/\s+/); break } }
  // times from the plan: STD and STA (UTC), and the taxi time; the aircraft is airborne from STD + taxi
  const hm = (h, m) => +h * 60 + +m;
  for(const l of L){ const m = l.match(/\bSTD:(\d{2})(\d{2})Z\b.*\bSTA:(\d{2})(\d{2})Z\b/); if(m && B.date != null){ B.std = B.date + hm(m[1], m[2]) * 6e4; B.sta = B.date + hm(m[3], m[4]) * 6e4; if(B.sta < B.std) B.sta += 864e5; break } }
  if(B.std == null && B.date != null) for(const l of L){ const m = l.match(/^ETD: (\d{2})\/(\d{2})(\d{2})Z\b/); if(m){ B.std = B.date + hm(m[2], m[3]) * 6e4; break } }
  for(const l of L){ const m = l.match(/^TAXI\s+\d+\s+(\d{2}):(\d{2})\b/); if(m){ B.taxi = hm(m[1], m[2]); break } }
  // ICAO to IATA from section and weather headings: "VABB / BOM", "VOHS -HYD - NAME"
  for(const l of L){ let m = l.match(/^([A-Z]{4}) \/ ([A-Z]{3})(?: |$)/) || l.match(/^([A-Z]{4}) -([A-Z]{3}) -/); if(m) B.icao[m[1]] = m[2] }

  // route: a waypoint line followed by its N/E line; ends at the destination
  const destI = Object.keys(B.icao).find(k => B.icao[k] === B.dest);
  for(let i = 0; i < L.length - 1; i++){
    const c = L[i + 1].match(/^([NS])(\d{2})(\d{2})(\d) ([EW])(\d{3})(\d{2})(\d)\b/); if(!c) continue;
    const name = L[i].split(" ")[0]; if(!/^[A-Z0-9]{2,7}$/.test(name)) continue;
    let lat = +c[2] + (+c[3] + c[4] / 10) / 60, lon = +c[6] + (+c[7] + c[8] / 10) / 60; if(c[1] === "S") lat = -lat; if(c[5] === "W") lon = -lon;
    const last = B.route[B.route.length - 1];
    if(B.route.length > 1 && name === B.route[0].n) break;
    const ct = L[i + 1].match(/\s(\d{2})(\d{2})\s+\d{3,6}\s*$/), ctm = ct ? hm(ct[1], ct[2]) : (B.route.length ? null : 0);
    if(!last || Math.abs(last.lon - lon) + Math.abs(last.lat - lat) > 1e-4) B.route.push({n:name, lon, lat, ctm});
    if(destI && name === destI && B.route.length > 1) break;
  }
  for(const l of L){ const m = l.match(/\bTMP [-+]\d{2}\/(\d{3})\b/); if(m){ B.fl = +m[1]; break } }

  // winds aloft: a row of "FL name FL name" headings, then rows of "400 -56 294/046/02 ..."
  let names = null;
  for(const l of L){
    if(/^(CLIMB|ENROUTE|DESCENT) WINDS$/.test(l)){ names = null; continue }
    const h = l.match(/^FL ([A-Z0-9]{2,7})(?: FL ([A-Z0-9]{2,7}))?(?: FL ([A-Z0-9]{2,7}))?(?: FL ([A-Z0-9]{2,7}))?$/);
    if(h){ names = h.slice(1).filter(Boolean); continue }
    if(!names) continue;
    const rows = [...l.matchAll(/(\d{3}) ([-+]\d{2}) (\d{3})\/(\d{3})\/(\d{2})/g)];
    if(!rows.length){ if(!/^TMP/.test(l)) names = null; continue }
    rows.forEach((m, j) => { const n = names[j]; if(!n) return; (B.winds[n] = B.winds[n] || []).push({fl:+m[1], t:+m[2], dir:+m[3], kt:+m[4]}) });
  }

  // weather: "VOHS -HYD - NAME", then SA (METAR) and FT/FC (TAF) lines until the next heading
  let st = null, buf = null;
  const flush = () => { if(st && buf){ const w = B.wx[st.iata] || (B.wx[st.iata] = {icao:st.icao, name:st.name}); if(buf.k === "SA") w.metar = buf.t.join(" "); else if(!w.taf || buf.k === "FT") w.taf = buf.t.join(" ") } buf = null };
  for(const l of L){
    const h = l.match(/^([A-Z]{4}) -([A-Z]{3}) - (.+)$/); if(h){ flush(); st = {icao:h[1], iata:h[2], name:h[3]}; continue }
    if(!st) continue;
    const s = l.match(/^(SA|FT|FC) \d{6}Z\b/); if(s){ flush(); buf = {k:s[1], t:[l.replace(/^(SA|FT|FC) /, "")]}; if(/=$/.test(l)) flush(); continue }
    if(buf){ buf.t.push(l); if(/=$/.test(l)) flush(); continue }
    if(/^\$B$|^[A-Z]{3,4}\d+ \d{2}[A-Z]{3}\d{2}/.test(l) || /^(OPERATIONAL FLIGHT PLAN|AERODROME INFORMATION)/.test(l)) st = null;
  }
  flush();

  // NOTAMs: "VOMMA3449/26 (05 NOV 26)", then "*05 NOV 2026 01:00-31 JAN 2027 12:30*", then the text
  const idOf = l => l.match(/(?:^|\s)\*?([A-Z]{4}[A-Z]\d{1,4}\/\d{2}|AIC \d{2,5}\/\d{2}) \((\d{2} [A-Z]{3} \d{2})\)$/);
  const isSect = l => /^[A-Z]{3,4} \/ [A-Z][A-Z ]+$/.test(l) && !/\d/.test(l) && !/^(TAXI|LDG|TKOF|DEP|ARR|ALTN|DEST|ETOPS|EDTO) \//.test(l);   // flight plan headings look alike
  let sect = null, ad = false, cur = null; const seen = new Set();
  const close = () => { if(!cur) return; const n = cur; cur = null; if(seen.has(n.id)) return; seen.add(n.id); build(n) };
  const build = n => {
    const body = n.lines.filter(l => l && !/^N I L$/.test(l));
    let i = 0; const v = (body[0] || "").match(/^\*(\d{2} [A-Z]{3} \d{4}) (\d{2}:\d{2})-(?:(\d{2} [A-Z]{3} \d{4}) (\d{2}:\d{2})|PERM)\*/);
    if(v){ n.from = utc(v[1], v[2]); n.to = v[3] ? utc(v[3], v[4]) : null; i = 1 }
    const sl = body[i] || "";
    if(/^"?(?:(?:MON|TUE|WED|THU|FRI|SAT|SUN|DAILY)\b[ A-Z]*)?\d{4}\s?-\s?\d{4}/.test(sl) && sl.length < 140){ n.sched = schedule(sl); n.schedText = sl.replace(/"/g, ""); i++ }
    const text = (n.title ? [n.title] : []).concat(body.slice(i)); delete n.title;
    let lo = null, hi = null; const rest = [];
    for(const l of text){ const f = l.match(/^F\) (.+)$/), g = l.match(/^G\) (.+)$/); if(f){ n.loT = f[1]; lo = feet(f[1]) } else if(g){ n.hiT = g[1]; hi = feet(g[1]) } else rest.push(l) }
    n.lo = lo; n.hi = hi; textLimits(n, rest.join(" ")); lo = n.lo; hi = n.hi;
    n.lo = lo; n.hi = hi; n.text = rest.join("\n"); delete n.lines;
    const flat = rest.join(" "), joined = rest.join("");
    // airspace activation tables: "1 TRA503(A) PUNE 0130 1200 FL325 FL460"
    if(/AIRSPACE ID\b.*TIME FM/.test(flat)){
      for(const l of rest){ const m = l.match(/^\d+ (\S+)(?: ([A-Z][A-Z ]*?))? (\d{4}) (\d{4}) (SFC|GND|FL\d{3}|\d+ FT \w+) (FL\d{3}|UNL|\d+ FT \w+)$/);
        if(m) B.aup.push({id:m[1], place:m[2] || "", a:m[3], b:m[4], lo:feet(m[5]), hi:feet(m[6]), loT:m[5], hiT:m[6], src:n.id}) }
      n.kind = "aup"; n.sect = sect; B.notams.push(n); return }
    const pts = coords(joined);
    const rad = flat.match(/RADIUS[^0-9]{0,30}(\d+(?:\.\d+)?)\s?(NM|KM|M)\b/) || flat.match(/(\d+(?:\.\d+)?)\s?(NM|KM)\s+RADIUS/);
    if(pts.length && rad){ const around = coords(joined.slice(Math.max(0, joined.search(/AROUND|CENT(RE|ER)D?|CENTERED/)))); const c = (around[0] || pts[0]);
      const r = +rad[1] * (rad[2] === "KM" ? 0.54 : rad[2] === "M" ? 0.00054 : 1); n.shape = {t:"circle", c, r} }
    else if(pts.length >= 3){ const p = pts.slice(); const a = p[0], z = p[p.length - 1]; if(Math.abs(a[0] - z[0]) + Math.abs(a[1] - z[1]) > 1e-6) p.push(a); n.shape = {t:"poly", p} }
    else if(pts.length === 2) n.shape = {t:"line", p:pts};
    else if(pts.length === 1) n.shape = {t:"pt", c:pts[0]};
    n.kind = kindOf(flat); n.sect = sect; n.ad = ad ? sect : null;
    if(ad){ n.adk = adKind(flat); if(n.adk.k === "rwy" && !n.sched){ const s = schedule(flat.replace(/\b\d{2} [A-Z]{3} \d{2,4}\b/g, "")); if(s){ n.sched = s; n.schedFromText = true } } }
    B.notams.push(n);
  };
  for(const l of L){
    if(l === "AERODROME INFORMATION"){ close(); ad = true; continue }
    if(isSect(l)){ close(); const m = l.match(/^([A-Z]{3,4}) \/ (.+)$/); sect = ad && m[2].length === 3 ? m[2] : m[1];
      const key = (ad ? "AD:" : "FIR:") + sect; if(!B.sects.includes(key)) B.sects.push(key); continue }   // every place the briefing covers, NIL ones too
    const idm = idOf(l); if(idm){ close(); const title = l.slice(0, idm.index).trim(); cur = {id:idm[1], issued:idm[2], lines:[], title}; continue }
    if(cur){
      // a weather or flight plan block ends the NOTAM area
      if(/^(SA|FT|FC) \d{6}Z\b/.test(l) || /^OPERATIONAL FLIGHT PLAN/.test(l)){ close(); continue }
      cur.lines.push(l);
    }
  }
  close();
  if(B.altnIcao) B.altn = B.altnIcao.map(k => B.icao[k] || k);
  // forecast flying times are not read; the map's time slider covers the whole plan day
  return B;
}

// a briefing's NOTAM location: the airport, or the FIR section it was listed under
export const locKey = n => n.ad ? "AD:" + n.ad : "FIR:" + (n.sect || "-");

// observation time of a METAR ("092230Z"), in the month of the briefing date (or the month before, for day numbers after it)
export function obsTime(metar, ref){
  const m = (metar || "").match(/^(\d{2})(\d{2})(\d{2})Z/); if(!m || !ref) return null; const d = new Date(ref);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), +m[1], +m[2], +m[3]); if(t - ref > 20 * 864e5) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, +m[1], +m[2], +m[3]); return t }

// no F)/G) lines: take limits written in the text ("UPPER LIMIT 447.63FT AMSL", "LOWER LIMIT GND"); an obstacle stands on the ground
export function textLimits(n, tx = n.text || ""){
  tx = tx.replace(/\s+/g, " "); const clean = v => v.replace(/(\d)\.\d+/, "$1");
  if(n.hi == null){ const m = tx.match(/UPPER\s+LIMIT[:\s]+(FL\s?\d{2,3}|[\d.]+\s?(?:FT|M)(?:\s?(?:AMSL|AGL))?|UNL)/); if(m){ n.hiT = clean(m[1]); n.hi = feet(n.hiT) } }
  if(n.lo == null){ const m = tx.match(/LOWER\s+LIMIT[:\s]+(FL\s?\d{2,3}|[\d.]+\s?(?:FT|M)(?:\s?(?:AMSL|AGL))?|SFC|GND)/); if(m){ n.loT = clean(m[1]); n.lo = feet(n.loT) } }
  if(n.hi != null && n.lo == null && /\b(OBST|CRANE|TOWER|MAST|CHIMNEY|BLDG|BUILDING)\b/.test(tx)){ n.lo = 0; n.loT = "GND" }
  return n }

// weather category from a METAR: visibility in metres, lowest broken/overcast layer in feet
export function wxCat(metar){
  if(!metar) return null;
  const vis = (() => { const m = metar.match(/\b(\d{4})\b(?!\/)/g); const v = m ? m.map(Number).filter(x => x <= 9999) : []; return /CAVOK/.test(metar) ? 9999 : v.length ? v[0] : null })();
  const cl = [...metar.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)].map(m => +m[2] * 100); const ceil = cl.length ? Math.min(...cl) : null;
  const wind = metar.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  const temp = metar.match(/\b(M?\d{2})\/(M?\d{2})\b/), qnh = metar.match(/\bQ(\d{4})\b/);
  let cat = "good"; if((vis != null && vis < 1500) || (ceil != null && ceil < 500)) cat = "poor"; else if((vis != null && vis < 5000) || (ceil != null && ceil < 1500)) cat = "marg";
  return {cat, vis, ceil, wind: wind ? {dir:wind[1], kt:+wind[2], g:wind[3] ? +wind[3] : null} : null,
    temp: temp ? temp[1].replace("M", "-") : null, qnh: qnh ? +qnh[1] : null, wx: (metar.match(/\b(\+|-)?(TS|SH|RA|DZ|BR|HZ|FG|DU|SA|FU|SQ)\w*\b/g) || []).join(" ")} }
