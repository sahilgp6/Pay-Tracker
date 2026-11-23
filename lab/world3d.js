/* 3D route globe for the Pay Tracker lab, built on Three.js (vendor/three, MIT).
   The Earth is a sphere wrapped in a map drawn from Natural Earth outlines; every route flown this month arcs above it
   with a plane flying it out and back, nose first. Drag to spin, pinch or scroll to zoom. Tap a plane and the camera
   flies in behind it and follows, with a bubble of stats floating over it; tap an airport to fly there; tap empty
   space to pull back out. Reduce Motion: planes hold still and the camera moves without gliding. */
import * as THREE from "./vendor/three/three.module.min.js";
import { WORLD, REGION, INDIA } from "./globedata.js";
import { build737 } from "./jet737.js?b=94";

const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const D2R = Math.PI / 180;
// lon/lat to a point on the sphere, matching how Three wraps an equirectangular texture
function v3(lon, lat, r = 1) {
  const phi = (lon + 180) / 360 * Math.PI * 2, la = lat * D2R;
  return new THREE.Vector3(-Math.cos(phi) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(phi) * Math.cos(la) * r);
}
function toLonLat(v) {
  const n = v.clone().normalize(), lat = Math.asin(n.y) / D2R;
  let phi = Math.atan2(n.z, -n.x); if (phi < 0) phi += Math.PI * 2;
  return { lon: phi / (Math.PI * 2) * 360 - 180, lat };
}
const css = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

/* The world map drawn onto the globe is a 4096 x 2048 picture: drawing its 269 coastlines and borders took most of the
   opening time. It is now drawn once, kept in memory, and saved on the phone (Cache Storage) so later launches only decode it. */
const EARTH = {}, EARTH_KEY = d => `earth-${d ? "dark" : "light"}-${(WORLD.length + REGION.length + INDIA.length).toString(36)}-v1.png`;
async function earthCanvas(dark) {
  if (EARTH[dark]) return EARTH[dark];
  const key = "https://pt-lab.local/" + EARTH_KEY(dark);
  try { const cache = await caches.open("pt-lab-globe"), hit = await cache.match(key);
    if (hit) { const bmp = await createImageBitmap(await hit.blob()), c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d").drawImage(bmp, 0, 0); return EARTH[dark] = c } } catch (e) {}
  const c = drawEarth(dark); EARTH[dark] = c;
  setTimeout(() => { try { c.toBlob(b => { if (b) caches.open("pt-lab-globe").then(cache => cache.put(key, new Response(b, { headers: { "content-type": "image/png" } }))).catch(() => {}) }, "image/png") } catch (e) {} }, 1500);
  return c;
}
async function earthTexture(dark) { const t = new THREE.CanvasTexture(await earthCanvas(dark)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t }
// get the globe ready in the background (called when the Month screen is idle) so the first tap opens at once
export async function prewarm(dark) { await earthCanvas(dark); if (!JET) JET = build737({ detail: false }) }
function drawEarth(dark) {
  const W = 4096, H = 2048, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const sea = dark ? "#0e2038" : "#9fb9d6", land = dark ? "#223249" : "#f1ece1", india = dark ? "#2b4266" : "#e6eaf2", edge = dark ? "#3c5679" : "#9aaecb";
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  g.strokeStyle = dark ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.35)"; g.lineWidth = 1.5;
  for (let lo = -180; lo <= 180; lo += 15) { const x = (lo + 180) / 360 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
  for (let la = -75; la <= 75; la += 15) { const y = (90 - la) / 180 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  const draw = (data, fill, stroke) => {
    for (const ring of data.split("|")) {
      const pts = ring.split(" ").map(p => p.split(",").map(Number)); if (pts.length < 3) continue;
      g.beginPath(); pts.forEach(([lo, la], i) => { const x = (lo + 180) / 360 * W, y = (90 - la) / 180 * H; i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath();
      g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke() }
    }
  };
  draw(WORLD, land); draw(REGION, land); draw(INDIA, india, edge);
  return c;
}

/* The jets: the measured 737-8 from jet737.js. A light build for every plane on the globe, and a detailed one
   (windows, doors, flap-track fairings, chevrons) swapped in only for the plane you are following. */
let JET = null, JETD = null;
export { build737 };
function ghost(jet) { jet.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .55 } }); return jet }
function planeMesh(deadhead) {
  if (!JET) JET = build737({ detail: false });
  const g = new THREE.Group(), jet = JET.clone(true);
  if (deadhead) ghost(jet);
  g.add(jet); g.userData.light = jet; g.userData.dh = deadhead;
  return g;
}
function setDetail(g, on) {   // the followed plane gets the detailed build
  if (!!g.userData.detailOn === on) return;
  if (on && !g.userData.detail) { if (!JETD) JETD = build737({ detail: true }); g.userData.detail = JETD.clone(true); if (g.userData.dh) ghost(g.userData.detail); g.add(g.userData.detail) }
  if (g.userData.detail) g.userData.detail.visible = on; g.userData.light.visible = !on; g.userData.detailOn = on;
}

export async function openGlobe(o) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const wrap = document.createElement("div"); wrap.className = "globe"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "3D route globe");
  wrap.innerHTML = `<div class="gtop"><div role="button" tabindex="0" class="wclose" data-gclose="1" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
      <div class="gtitle"><b>${o.title}</b><span>${o.sub}</span></div>
      <div role="button" tabindex="0" class="wclose" data-gfit="1" aria-label="Back to all routes"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></div></div>
    <div class="glabels" aria-hidden="true"></div><div class="gbubble" hidden></div>`;
  document.body.appendChild(wrap); document.documentElement.classList.add("sheet-open");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.domElement.className = "gcanvas";
  wrap.insertBefore(renderer.domElement, wrap.querySelector(".glabels"));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, dark ? .9 : 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.3); scene.add(sun);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshLambertMaterial({ map: await earthTexture(dark) }));
  scene.add(earth);
  // a soft rim of atmosphere
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 48), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color(dark ? 0x4f86d6 : 0x8fb6e8) } },
    vertexShader: "varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: "uniform vec3 c;varying vec3 n;void main(){float i=pow(.72-dot(n,vec3(0,0,1.)),3.);gl_FragColor=vec4(c,1.)*i;}"
  }));
  scene.add(glow);

  const navy = new THREE.Color(css("--accent", "#1f3f6e")), gold = new THREE.Color(css("--gold", "#7a6232"));
  const routeCol = dark ? 0x8fb3e8 : 0x1f3f6e, planeCol = dark ? 0xf3f0e8 : 0x1b2230;
  // routes: great-circle arcs lifted off the surface, higher for longer sectors
  const routes = o.routes.map(r => {
    const a = v3(r.A.lon, r.A.lat), b = v3(r.B.lon, r.B.lat), ang = a.angleTo(b), h = .008 + ang * .13, pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64, p = new THREE.Vector3().copy(a).lerp(b, t).normalize().multiplyScalar(1 + h * Math.sin(Math.PI * t)); pts.push(p) }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, .0008, 6, false), new THREE.MeshBasicMaterial({ color: r.dh ? 0x8a93a3 : routeCol, transparent: true, opacity: r.dh ? .5 : .9 }));
    scene.add(tube);
    const plane = planeMesh(r.dh); plane.userData.k = r.k; scene.add(plane);
    // a soft shadow on the ground under each jet: it lifts the jet off the map and shows its height
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x0b1628, transparent: true, opacity: .28, depthWrite: false })); scene.add(shadow);
    const len = curve.getLength(), dur = Math.max(7, Math.min(20, len * 47));   // seconds per leg: unhurried, about 1.8x the old pace
    return { ...r, curve, tube, plane, shadow, dur, off: Math.random() * dur * 2, dir: 1, t: 0 };
  });
  // airports
  const stnObjs = o.stations.map(s => {
    const p = v3(s.lon, s.lat, 1.001), m = new THREE.Mesh(new THREE.SphereGeometry(s.home ? .007 : .0052, 12, 10), new THREE.MeshBasicMaterial({ color: s.home ? 0x2c4f86 : s.abroad ? 0xc9a45a : routeCol }));
    m.position.copy(p); m.userData = { code: s.code }; scene.add(m);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); hit.position.copy(p); hit.userData = { code: s.code }; scene.add(hit);
    const el = document.createElement("span"); el.className = "glbl" + (s.home ? " home" : ""); el.textContent = s.code; wrap.querySelector(".glabels").appendChild(el);
    return { ...s, p, m, hit, el };
  });

  // camera: orbit around the globe, centred on this month's flying
  const c0 = o.center, cam = { lon: c0.lon, lat: c0.lat, dist: o.dist };
  let follow = null, focusStn = null, anim = null;
  const bubble = wrap.querySelector(".gbubble"), bub = { x: innerWidth / 2, y: innerHeight / 2, sx: 0, sy: 0 };
  const orbitPos = (lon, lat, d) => v3(lon, lat, d);
  function size() { const w = wrap.clientWidth, h = wrap.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
  size(); addEventListener("resize", size);

  // ---- input: drag spins, pinch and scroll zoom, a still tap picks
  const ptrs = new Map(); let start = null, moved = false, pinch = null;
  const orb = { yaw: 0, pitch: 0, zoom: 1 };   // following a jet: where the camera sits round it (drag to orbit, pinch to move in and out)
  const cv = renderer.domElement; cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (ptrs.size === 1) start = { x: e.clientX, y: e.clientY, lon: cam.lon, lat: cam.lat, yaw: orb.yaw, pitch: orb.pitch };
    if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), dist: cam.dist, zoom: orb.zoom } } });
  cv.addEventListener("pointermove", e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch && follow) { const [p, q] = [...ptrs.values()]; orb.zoom = THREE.MathUtils.clamp(pinch.zoom * pinch.d / Math.max(20, Math.hypot(p.x - q.x, p.y - q.y)), .45, 3); moved = true; return }
    if (ptrs.size === 2 && pinch) { const [p, q] = [...ptrs.values()]; release(); cam.dist = THREE.MathUtils.clamp(pinch.dist * Math.pow(pinch.d / Math.max(20, Math.hypot(p.x - q.x, p.y - q.y)), .8), 1.12, 4.5); moved = true; return }
    if (ptrs.size === 1 && start) { const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.hypot(dx, dy) > 10) moved = true; if (!moved) return;
      if (follow) { orb.yaw = start.yaw - dx * .008; orb.pitch = THREE.MathUtils.clamp(start.pitch + dy * .006, -.3, 1.1); return }   // stays 3D: orbit the jet
      release(); const k = .055 * (cam.dist - .95); cam.lon = start.lon - dx * k; cam.lat = THREE.MathUtils.clamp(start.lat + dy * k, -80, 80) } });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { const [p] = [...ptrs.values()]; start = { x: p.x, y: p.y, lon: cam.lon, lat: cam.lat, yaw: orb.yaw, pitch: orb.pitch } }
    if (ptrs.size === 0 && !moved) pick(e.clientX, e.clientY) };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); pinch = null });
  cv.addEventListener("wheel", e => { e.preventDefault(); if (follow) { orb.zoom = THREE.MathUtils.clamp(orb.zoom * Math.exp(e.deltaY * .0012), .45, 3); return } release(); cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * .0008), 1.12, 4.5) }, { passive: false });

  // leaving follow or airport focus: hand the current view back to the orbit controls
  function release() {
    if (!follow && !focusStn) return;
    const ll = toLonLat(camera.position); cam.lon = ll.lon; cam.lat = ll.lat; cam.dist = Math.max(1.3, camera.position.length());
    follow = null; focusStn = null; bubble.hidden = true; camera.up.set(0, 1, 0); routes.forEach(r => r.tube.material.opacity = r.dh ? .5 : .9);
  }
  const ray = new THREE.Raycaster();
  function pick(x, y) {
    // the nearest thing to your finger on screen wins: an airport within 28 px first, else a plane within 44 px
    const r = cv.getBoundingClientRect(), W = r.width, H = r.height, cdir = camera.position.clone().normalize();
    const at = v => { const q = v.clone().project(camera); return { x: r.left + (q.x + 1) / 2 * W, y: r.top + (1 - q.y) / 2 * H, front: q.z < 1 && v.clone().normalize().dot(cdir) > .05 } };
    let best = null;
    for (const st of stnObjs) { const q = at(st.p), d = Math.hypot(q.x - x, q.y - y); if (q.front && d < 22 && (!best || d < best.d)) best = { d, code: st.code } }
    if (!best) for (const rt of routes) { const q = at(rt.plane.position), d = Math.hypot(q.x - x, q.y - y); if (q.front && rt.vis > .5 && d < 30 && (!best || d < best.d)) best = { d, k: rt.k } }
    if (!best) { if (follow || focusStn) { release(); fly({ lon: cam.lon, lat: cam.lat, dist: Math.max(cam.dist, o.dist) }) } return }
    if (best.code) { follow = null; focusStn = stnObjs.find(s => s.code === best.code); showBubble("stn", best.code); routes.forEach(q => q.tube.material.opacity = q.k.split("-").includes(best.code) ? 1 : .25); return }
    follow = routes.find(q => q.k === best.k); if (follow) follow.sf = null; orb.yaw = 0; orb.pitch = 0; orb.zoom = 1; focusStn = null; showBubble("route", best.k);
    routes.forEach(q => q.tube.material.opacity = q === follow ? .35 : .15);   // faint while following, so the line doesn't hide the jet
  }
  function showBubble(kind, key) {
    const dirFrom = kind === "route" && follow ? (follow.dir > 0 ? follow.a : follow.b) : null;
    bubble.innerHTML = o.bubble(kind, key, dirFrom); bubble.hidden = false; bubble.dataset.kind = kind;
    if (!RM()) { bubble.classList.remove("pop"); void bubble.offsetWidth; bubble.classList.add("pop") }
  }
  function fly(to) { if (RM()) { Object.assign(cam, to); return } anim = { from: { ...cam }, to, t0: performance.now(), d: 700 } }

  wrap.addEventListener("click", e => { const t = e.target.closest("[role=button]"); if (!t) return;
    if (t.dataset.gclose) close();
    else if (t.dataset.gfit) { release(); fly({ lon: c0.lon, lat: c0.lat, dist: o.dist }) } });
  const esc = e => { if (e.key === "Escape" && !document.querySelector("#sheetWrap:not([hidden])")) close() }; addEventListener("keydown", esc);

  // ---- the loop
  let raf = 0, last = performance.now(), dead = false;
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), upv = new THREE.Vector3(), want = new THREE.Vector3(), look = new THREE.Vector3();
  const ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  function frame(now) {
    if (dead) return; raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (anim) { const p = Math.min(1, (now - anim.t0) / anim.d), e = ease(p); cam.lon = anim.from.lon + (anim.to.lon - anim.from.lon) * e; cam.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e; cam.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * e; if (p >= 1) anim = null }
    // planes: out, a pause at the far end, back, a pause at home; always nose first
    const zoom = camera.position.length(), s = THREE.MathUtils.clamp((zoom - 1) * 1.0, .14, 2.6);   // same size on screen at any zoom
    for (const r of routes) {
      const G = 1.8, cyc = r.dur * 2 + G * 2, tt = RM() ? r.dur * .5 : ((now / 1000 + r.off) % cyc);   // G: seconds on the ground at each end, jet hidden
      let t, dir, u = -1; if (tt < r.dur) { u = tt / r.dur; t = ease(u); dir = 1 } else if (tt < r.dur + G) { t = 1; dir = -1 } else if (tt < r.dur * 2 + G) { u = (tt - r.dur - G) / r.dur; t = 1 - ease(u); dir = -1 } else { t = 0; dir = 1 }
      const ramp = x => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x) };
      const vis = u < 0 ? 0 : Math.pow(ramp(Math.min(t, 1 - t) / .3), .8);   // shrinks down the approach (last 30% of the track) to nothing at touchdown; grows the same way on the climb
      r.vis = vis; r.plane.visible = r.shadow.visible = vis > .01;   // grows from the runway on takeoff, shrinks into it on landing
      r.t = t; r.dir = dir;
      const p = r.curve.getPointAt(THREE.MathUtils.clamp(t, .0005, .9995)); r.curve.getTangentAt(THREE.MathUtils.clamp(t, .0005, .9995), fwd); if (dir < 0) fwd.negate();
      r.plane.position.copy(p); r.plane.up.copy(upv.copy(p).normalize()); r.plane.lookAt(tmp.copy(p).add(fwd)); setDetail(r.plane, follow === r); const ps = (follow === r ? 1.45 : s) * Math.max(vis, .001); r.plane.scale.setScalar(ps);
      const g0 = tmp.copy(p).normalize(), alt = p.length() - 1; r.shadow.position.copy(g0).multiplyScalar(1.0008); r.shadow.lookAt(0, 0, 0); r.shadow.scale.set(ps * .016, ps * .009, 1); r.shadow.material.opacity = .32 * vis * Math.max(.25, 1 - alt * 7);
      r.fwd = fwd.clone();
    }
    for (const st of stnObjs) st.m.scale.setScalar(THREE.MathUtils.clamp((zoom - 1) * 1.1, .25, 2.2));
    // camera
    if (follow) {
      const p = follow.plane.position; upv.copy(p).normalize();
      // a smoothed heading: at a turnaround the camera swings round gently instead of through the route
      // heading over the ground: the arc's climb and descent are left out, so the camera never tips into the sky
      const hd = tmp.copy(follow.fwd).addScaledVector(upv, -follow.fwd.dot(upv)); if (hd.lengthSq() < 1e-8) hd.copy(follow.sf || camera.getWorldDirection(new THREE.Vector3())); hd.normalize();
      if (!follow.sf) follow.sf = hd.clone(); follow.sf.lerp(hd, RM() ? 1 : .04).addScaledVector(upv, -follow.sf.dot(upv)).normalize();
      // low behind the plane by default, so you see the horizon ahead; dragging swings the camera round it, pinching moves it in and out
      const dir = fwd.copy(follow.sf).applyAxisAngle(upv, orb.yaw), el = Math.atan2(.065, .17) + orb.pitch, dd = .182 * orb.zoom;
      want.copy(p).addScaledVector(upv, Math.sin(el) * dd).addScaledVector(dir, -Math.cos(el) * dd);
      camera.position.lerp(want, RM() ? 1 : .08); camera.up.lerp(upv, .1); camera.lookAt(look.copy(p).addScaledVector(dir, .09 * Math.max(0, Math.cos(orb.yaw)) * Math.cos(orb.pitch)).addScaledVector(upv, .012));
    } else if (focusStn) {
      want.copy(focusStn.p).multiplyScalar(1.7); camera.position.lerp(want, RM() ? 1 : .08); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
    } else { camera.position.copy(orbitPos(cam.lon, cam.lat, cam.dist)); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0) }
    sun.position.copy(camera.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), .6).add(new THREE.Vector3(0, 1.5, 0));
    glow.lookAt(camera.position); glow.visible = camera.position.length() > 1.45;   // the rim glow only reads from a distance
    renderer.render(scene, camera);
    // labels and bubble follow their 3D points
    const W = wrap.clientWidth, H = wrap.clientHeight, cdir = camera.position.clone().normalize(), placed = [];
    const scr = v => { const q = v.clone().project(camera); return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H, z: q.z } };
    const fq = follow ? scr(follow.plane.position) : null;
    for (const st of stnObjs) {
      const facing = st.p.clone().normalize().dot(cdir) > .12, q = scr(st.p);
      const clash = placed.some(([x, y]) => Math.abs(x - q.x) < 34 && Math.abs(y - q.y) < 16);
      if (!facing || clash || q.z > 1) { st.el.style.opacity = 0; continue }
      let op = 1;
      if (follow) {   // up close: a station's tag grows in as the jet nears it, and stays out of the jet's way
        const d = camera.position.distanceTo(st.p); op = Math.min(1, Math.max(.16, 1 - (d - .1) / .3));
        if (Math.abs(q.x - fq.x) < 80 && Math.abs(q.y - fq.y) < 70) op = Math.min(op, .1) }
      placed.push([q.x, q.y]); st.el.style.opacity = op.toFixed(2);
      st.el.style.transform = `translate(${q.x}px,${q.y - 14}px) translate(-50%,-100%) scale(${(.78 + .22 * op).toFixed(3)})`;
    }
    if (!bubble.hidden) {
      const target = follow ? follow.plane.position.clone().addScaledVector(follow.plane.position.clone().normalize(), .03) : focusStn ? focusStn.p : null;   // float above the plane, clear of it
      // the bubble eases after its target and only moves for real changes, so it stays steady enough to tap
      if (target) { const q = scr(target.clone().multiplyScalar(1.01)), b = bub; b.x += (q.x - b.x) * .2; b.y += (q.y - 26 - b.y) * .2;
        const bx = Math.round(Math.min(W - 150, Math.max(150, b.x))), by = Math.round(Math.max(bubble.offsetHeight + 70, b.y));
        if (Math.abs(bx - b.sx) > 1.5 || Math.abs(by - b.sy) > 1.5) { b.sx = bx; b.sy = by; bubble.style.transform = `translate(${bx}px,${by}px) translate(-50%,-100%)` } }
    }
  }
  raf = requestAnimationFrame(frame);
  if (!RM()) { const from = { lon: c0.lon + 40, lat: c0.lat - 10, dist: 4.2 }; Object.assign(cam, from); fly({ lon: c0.lon, lat: c0.lat, dist: o.dist }) }

  function close() {
    dead = true; cancelAnimationFrame(raf); removeEventListener("resize", size); removeEventListener("keydown", esc);
    document.documentElement.classList.remove("sheet-open");
    wrap.classList.add("gout"); setTimeout(() => { renderer.dispose(); scene.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose() } }); wrap.remove() }, RM() ? 0 : 260);
    if (o.onClose) o.onClose();
  }
  // for automated checks: where each plane and airport sits on screen right now
  const spots = () => { const W = wrap.clientWidth, H = wrap.clientHeight, f = v => { const q = v.clone().project(camera); return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H } };
    return { planes: routes.filter(r => r.vis > .5).map(r => ({ k: r.k, vis: r.vis, ...f(r.plane.position) })), hidden: routes.filter(r => !r.plane.visible).length, ramping: routes.filter(r => r.vis > .02 && r.vis < .98).length, stations: stnObjs.map(s => ({ code: s.code, ...f(s.p) })), follow: follow && follow.k, focus: focusStn && focusStn.code } };
  return { close, wrap, spots };
}
