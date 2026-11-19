/* A Boeing 737-8 (MAX) built in code, measured from a three-view drawing and the published dimensions:
   length 39.52 m, span 35.92 m, fuselage 3.76 m wide and 4.01 m tall, wing leading edge swept 28 degrees with the
   trailing-edge kink 5.8 m out, LEAP-1B nacelles 12.9 m behind the nose and 5.0 m out, split scimitar winglets,
   tailplane swept 35 degrees, fin 6.8 m tall swept 41 degrees with a dorsal fillet.
   Built the img2threejs way: blockout, structure, form, then materials, each checked against the three views.
   Paint is the app's own: white upper fuselage, silver belly, wings and engines, an orange pinstripe under the windows
   and an orange fin. No airline livery, no logos.
   Frame: nose along +Z, up +Y, right wing +X. Units: the whole jet is LEN long (scene units), as before. */
import * as THREE from "./vendor/three/three.module.min.js";

const L = 39.52, LEN = .034, K = LEN / 39.5;          // metres -> scene units (same overall size as the old model)
const S = s => (L / 2 - s) * K;                         // station (m behind the nose) -> z
const WHITE = 0xf6f5f1, SILVER = 0xc3c8cf, SILVER_D = 0xa7adb6, ORANGE = 0xf28c28, DARK = 0x262b33, GLASS = 0x1a2230;

/* fuselage stations: [station m, half-width, top above datum, bottom below datum, datum height] (all metres).
   Datum height lifts towards the tail (the 737's upswept tail cone) and drops a touch at the nose. */
const FUS = [
  [0.00, .02, .02, .02, -.30], [0.25, .42, .40, .36, -.28], [0.6, .78, .74, .62, -.25], [1.2, 1.12, 1.10, .92, -.20],
  [2.0, 1.42, 1.42, 1.22, -.14], [3.2, 1.66, 1.72, 1.52, -.08], [4.2, 1.78, 1.86, 1.70, -.04], [5.9, 1.88, 1.98, 1.95, 0],
  [8.0, 1.88, 2.00, 2.01, 0], [26.5, 1.88, 2.00, 2.01, 0], [28.6, 1.84, 1.99, 1.85, .10], [30.6, 1.72, 1.92, 1.47, .26],
  [32.6, 1.52, 1.76, 1.06, .42], [34.6, 1.24, 1.50, .76, .56], [36.4, .92, 1.16, .50, .66], [37.8, .62, .80, .38, .72],
  [38.9, .36, .44, .24, .76], [39.3, .22, .26, .16, .78]];
const fusAt = s => { for (let i = 1; i < FUS.length; i++) if (s <= FUS[i][0]) { const a = FUS[i - 1], b = FUS[i], t = (s - a[0]) / (b[0] - a[0]);
  return a.map((v, k) => v + (b[k] - v) * t) } return FUS[FUS.length - 1] };

/* livery and windows painted onto the fuselage: u runs nose to tail, v runs round the section from the bottom */
function fuselageTexture(detail) {
  const W = detail ? 2048 : 512, H = detail ? 512 : 128, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), U = s => s / 39.3 * W, V = a => (a / (Math.PI * 2)) * H;   // a: angle from the bottom, 0..2pi
  g.fillStyle = "#f6f5f1"; g.fillRect(0, 0, W, H);
  // silver belly: the lower third all round
  const belly = .62; g.fillStyle = "#c3c8cf"; g.fillRect(0, 0, W, V(belly)); g.fillRect(0, V(Math.PI * 2 - belly), W, H - V(Math.PI * 2 - belly));
  // orange pinstripe just under the window line, both sides, from behind the cockpit to the tail cone
  const sideA = [Math.PI / 2, Math.PI * 1.5], win = .38, stripe = .25;
  g.fillStyle = "#f28c28";
  for (const a of sideA) { const dir = a < Math.PI ? -1 : 1; const y = V(a + dir * stripe); g.fillRect(U(5.2), y - H * .006, U(34.5) - U(5.2), H * .012) }
  if (detail) {
    // cabin windows and doors
    g.fillStyle = "#3b4350";
    for (const a of sideA) { const dir = a < Math.PI ? -1 : 1, y = V(a - dir * win);
      for (let s = 6.6; s < 33.4; s += .51) { if ((s > 15.4 && s < 16.4) || (s > 17.2 && s < 18.1)) continue; g.beginPath(); g.ellipse(U(s), y, W * .0028, H * .011, 0, 0, 7); g.fill() }
      g.strokeStyle = "rgba(60,66,78,.55)"; g.lineWidth = W * .0011;
      for (const s of [4.6, 15.8, 17.6, 33.9]) { const w = s === 15.8 || s === 17.6 ? .55 : .9; g.strokeRect(U(s), y - H * .045, U(s + w) - U(s), H * .095) } }
    // cockpit glazing: a dark band wrapping the nose
    g.fillStyle = "#1a2230";
    for (const a of sideA) { const dir = a < Math.PI ? -1 : 1; g.beginPath(); g.moveTo(U(1.75), V(a - dir * .85)); g.lineTo(U(2.9), V(a - dir * .72)); g.lineTo(U(3.15), V(a - dir * .5)); g.lineTo(U(1.95), V(a - dir * .55)); g.closePath(); g.fill() }
    g.beginPath(); g.moveTo(U(1.2), V(Math.PI - .55)); g.lineTo(U(1.9), V(Math.PI - .95)); g.lineTo(U(1.9), V(Math.PI + .95)); g.lineTo(U(1.2), V(Math.PI + .55)); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function fuselage(detail, mat) {
  const N = detail ? 64 : 26, M = detail ? 40 : 18, st = [];
  for (let i = 0; i <= N; i++) { const u = i / N, s = 39.3 * (u < .2 ? Math.pow(u / .2, 1.6) * .2 : u); st.push(s) }   // more rings round the nose
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) { const [s, hw, top, bot, dz] = fusAt(st[i]);
    for (let j = 0; j <= M; j++) { const a = j / M * Math.PI * 2, sx = Math.sin(a), cy = -Math.cos(a);   // a=0 bottom, pi top
      const r = cy > 0 ? top : bot, y = dz + cy * r, x = sx * hw;
      pos.push(x * K, y * K, S(s)); uv.push(st[i] / 39.3, j / M) } }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1) }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals(); return new THREE.Mesh(geo, mat);
}

/* a lifting surface lofted through sections: {s: leading-edge station m, x: span m, y: height m, c: chord m, t: thickness/chord}.
   axis "h" for wings and tailplanes (span along x), "v" for the fin (span upwards). */
const FOIL = [[0, 0], [.03, .55], [.12, .92], [.3, 1], [.55, .82], [.8, .42], [1, .04]];
function surface(secs, mat, axis = "h", segs = 1) {
  const P = FOIL.length, ring = [];
  for (const f of FOIL) ring.push([f[0], f[1]]); for (let i = P - 2; i > 0; i--) ring.push([FOIL[i][0], -FOIL[i][1]]);
  const R = ring.length, pos = [], idx = [];
  const sec = [];   // optional subdivision between sections for smoother shading
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < segs; k++) { const a = secs[i], b = secs[i + 1], t = k / segs; sec.push(Object.fromEntries(Object.keys(a).map(q => [q, a[q] + (b[q] - a[q]) * t]))) }
  sec.push(secs[secs.length - 1]);
  for (const q of sec) for (const [u, v] of ring) { const s = q.s + u * q.c, th = v * q.t * q.c / 2;
    if (axis === "h") pos.push(q.x * K, (q.y + th) * K, S(s)); else pos.push(th * K, q.y * K, S(s)) }
  for (let i = 0; i < sec.length - 1; i++) for (let j = 0; j < R; j++) { const a = i * R + j, b = a + R, a1 = i * R + (j + 1) % R, b1 = a1 + R; idx.push(a, b, a1, b, b1, a1) }
  // close both ends
  for (const base of [0, (sec.length - 1) * R]) for (let j = 1; j < R - 1; j++) idx.push(base, base + j, base + j + 1);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/* LEAP-1B nacelle: lathe profile with a scalloped (chevron) exhaust edge, fan face, spinner and core plug */
function nacelle(detail, M) {
  const g = new THREE.Group(), seg = detail ? 40 : 18;
  const prof = [[1.02, 0], [1.16, .12], [1.22, .45], [1.24, 1.2], [1.2, 2.2], [1.08, 3.0], [.98, 3.5]].map(([r, z]) => new THREE.Vector2(r * K, -z * K));
  const inner = [[.94, 3.5], [.98, 2.0], [.98, .25], [1.02, 0]].map(([r, z]) => new THREE.Vector2(r * K, -z * K));
  const shell = new THREE.Mesh(new THREE.LatheGeometry([...prof, ...inner], seg), M.engine); shell.rotation.x = Math.PI / 2; g.add(shell);   // profile runs aft (-Z)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.06 * K, .07 * K, 6, seg), M.lip); g.add(lip);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(.98 * K, seg), M.dark); fan.position.z = -.3 * K; g.add(fan);
  const spin = new THREE.Mesh(new THREE.ConeGeometry(.3 * K, .7 * K, 14), M.silverD); spin.rotation.x = Math.PI / 2; spin.position.z = -.0 * K; g.add(spin);
  if (detail) {   // chevrons: a ring of shallow teeth round the fan exhaust
    const n = 12, pos = [], idx = [];
    for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + .5) / n * Math.PI * 2, a2 = (i + 1) / n * Math.PI * 2, r = .97;
      const p = (a, rr, z) => [Math.cos(a) * rr * K, Math.sin(a) * rr * K, -z * K];
      const base = pos.length / 3; pos.push(...p(a0, r, 3.5), ...p(a1, r * .93, 3.82), ...p(a2, r, 3.5)); idx.push(base, base + 1, base + 2) }
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx); cg.computeVertexNormals();
    g.add(new THREE.Mesh(cg, M.engine)) }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(.62 * K, .5 * K, 1.0 * K, seg, 1, true), M.silverD); core.rotation.x = Math.PI / 2; core.position.z = -3.9 * K; g.add(core);
  const plug = new THREE.Mesh(new THREE.ConeGeometry(.42 * K, 1.1 * K, 14), M.dark); plug.rotation.x = -Math.PI / 2; plug.position.z = -4.85 * K; g.add(plug);
  return g;
}

export function build737({ detail = false } = {}) {
  const g = new THREE.Group();
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .15, ...o });
  const M = {
    fus: std(0xffffff, { map: fuselageTexture(detail), roughness: .42 }),
    wing: std(SILVER, { metalness: .35, roughness: .4, side: THREE.DoubleSide }), silverD: std(SILVER_D, { metalness: .4, roughness: .45 }),
    engine: std(SILVER, { metalness: .45, roughness: .35, side: THREE.DoubleSide }), lip: std(0xdfe3e8, { metalness: .6, roughness: .25 }),
    fin: std(ORANGE, { roughness: .45, side: THREE.DoubleSide }), dark: std(DARK, { roughness: .7 }), white: std(WHITE, { roughness: .45 }) };
  g.add(fuselage(detail, M.fus));
  // wing-body fairing under the centre section
  const bf = new THREE.Mesh(new THREE.SphereGeometry(1, detail ? 24 : 12, detail ? 12 : 6), M.silverD); bf.scale.set(1.7 * K, .55 * K, 6.0 * K); bf.position.set(0, -1.62 * K, S(18.4)); g.add(bf);
  const dih = Math.tan(6 * Math.PI / 180), sg = detail ? 3 : 1;
  for (const side of [1, -1]) {
    // wing: root inside the fuselage, kink at 5.8 m (straight trailing edge inboard), tip at 17.1 m
    const w = surface([{ s: 14.1, x: .6, y: -1.05, c: 8.3, t: .15 }, { s: 15.4, x: 1.9, y: -1.05 + 1.3 * dih, c: 7.0, t: .14 },
      { s: 17.5, x: 5.8, y: -1.05 + 5.2 * dih, c: 5.15, t: .12 }, { s: 23.15, x: 17.1, y: -1.05 + 16.5 * dih, c: 1.42, t: .1 }], M.wing, "h", sg);
    w.scale.x = side; g.add(w);
    // split scimitar winglet: a tall swept blade up and a short one down from the tip
    const tipY = -1.05 + 16.5 * dih;
    const up = surface([{ s: 23.15, x: 17.1, y: tipY, c: 1.42, t: .13 }, { s: 23.9, x: 17.35, y: tipY + .6, c: 1.1, t: .13 }, { s: 25.0, x: 17.75, y: tipY + 2.55, c: .45, t: .12 }], M.wing, "h", sg);
    up.scale.x = side; g.add(up);
    const dn = surface([{ s: 23.3, x: 17.1, y: tipY - .02, c: 1.15, t: .13 }, { s: 24.15, x: 17.6, y: tipY - 1.15, c: .42, t: .12 }], M.wing, "h", 1);
    dn.scale.x = side; g.add(dn);
    // engine under the wing, ahead of it, on a pylon
    const ex = side * 5.0, ey = -1.72, nac = nacelle(detail, M); nac.position.set(ex * K, ey * K, S(12.9)); g.add(nac);
    const pyl = surface([{ s: 13.6, x: 0, y: ey + .9, c: 4.6, t: .07 }, { s: 15.0, x: 0, y: ey + 1.45, c: 4.0, t: .06 }], M.silverD, "v", 1);
    pyl.position.x = ex * K; pyl.rotation.y = 0; g.add(pyl);
    if (detail) {   // flap-track fairings: canoes under the trailing edge
      for (const [x, te] of [[3.6, 22.45], [8.4, 23.0], [11.6, 23.45]]) { const f = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), M.silverD);
        f.scale.set(.22 * K, .28 * K, 1.35 * K); f.position.set(side * x * K, (-1.05 + x * dih - .22) * K, S(te + .25)); g.add(f) } }
    // tailplane: swept 35 degrees, a little dihedral
    const tp = surface([{ s: 33.9, x: .3, y: .55, c: 4.2, t: .1 }, { s: 34.5, x: 1.0, y: .58, c: 3.4, t: .1 }, { s: 38.65, x: 7.1, y: .58 + 6.1 * .12, c: .88, t: .09 }], M.wing, "h", sg);
    tp.scale.x = side; g.add(tp);
  }
  // fin and dorsal fillet, orange
  const fin = surface([{ s: 30.9, x: 0, y: 1.6, c: 6.6, t: .1 }, { s: 31.5, x: 0, y: 2.2, c: 6.0, t: .1 }, { s: 37.49, x: 0, y: 8.98, c: 1.74, t: .09 }], M.fin, "v", sg);
  g.add(fin);
  const dorsal = surface([{ s: 25.0, x: 0, y: 1.9, c: 7.4, t: .05 }, { s: 31.9, x: 0, y: 3.45, c: .8, t: .05 }], M.fin, "v", 1); g.add(dorsal);
  g.traverse(o => { if (o.isMesh) o.castShadow = false });
  return g;
}
