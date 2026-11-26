// Node-Tests für die Kern-Logik von index.html
// Aufruf:  node tests/run-tests.mjs
// Lädt genau den <script id="psp-core">-Block aus der App (kein Duplikat) in eine vm-Sandbox.
// opening_hours.js + SunCalc werden (falls Netz vorhanden) vom CDN geladen und zwischengespeichert.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(here, '..', 'index.html');
const html = fs.readFileSync(appPath, 'utf8');
const core = /<script id="psp-core">\n([\s\S]*?)<\/script>/.exec(html)[1];

const ctx = { TextDecoder, console, Date };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(core, ctx, { filename: 'psp-core' });
vm.runInContext(fs.readFileSync(path.join(here, 'fixtures.js'), 'utf8'), ctx, { filename: 'fixtures.js' });
const P = ctx.PSP, F = ctx.PSP_FIXTURES;

// ---- opening_hours.js laden (optional) ----
const CDN = {
  'suncalc.js': 'https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js',
  'opening_hours.js': 'https://cdn.jsdelivr.net/npm/opening_hours@3.16.0/build/opening_hours.js',
};
async function loadOH() {
  const dir = path.join(os.tmpdir(), 'psp-test-cache');
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, url] of Object.entries(CDN)) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
      fs.writeFileSync(p, await res.text());
    }
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx.opening_hours;
}

// ---- Mini-Testrunner ----
const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); }
  catch (e) { results.push([false, name, e.message]); }
}
const kms = arr => arr.map(c => c.km);
const C = (km, extra = {}) => ({ id: 'c' + km, km, distM: 50, openState: 'unknown', hasName: false, ...extra });
const arr = a => Array.from(a); // vm-Arrays → normale Arrays (für deepEqual)

const OH = await loadOH().catch(e => { console.log('⚠ opening_hours.js nicht ladbar (' + e.message + ') – Öffnungszeiten-Tests übersprungen'); return null; });

/* ===== 1. Auswahl-Algorithmus ===== */
test('Algorithmus: Kandidaten im Fenster (rückwärts größter km)', () => {
  const c = [1, 4.5, 6, 9.8, 14, 19].map(k => C(k));
  assert.deepEqual(arr(kms(P.selectPoints(c, 5, 20))), [4.5, 6, 9.8, 14, 19]);
});
test('Algorithmus: Fenster [p+D/5, t] – Punkt vor p+D/5 wird ignoriert', () => {
  // D=30: Fenster km 6–30; Punkt bei km 5 liegt davor → Vorwärtssuche → km 31
  assert.deepEqual(arr(kms(P.selectPoints([C(5), C(31)], 30, 100))), [31, 61].slice(0, 1));
});
test('Algorithmus: leeres Fenster → Vorwärts-Wahl (erster nach t)', () => {
  // p=0,t=5: Fenster [1,5] leer (0.5 liegt davor) → erster nach 5 = 8; p=8,t=13: nichts mehr → Stopp
  assert.deepEqual(arr(kms(P.selectPoints([C(0.5), C(8)], 5, 20))), [8]);
});
test('Algorithmus: leeres Fenster, mehrere Folgepunkte', () => {
  // p=0,t=5: Fenster [1,5] leer → 8; p=8,t=13: Fenster [9,13] leer → 15; p=15,t=20 ≥ L=20 → Stopp
  assert.deepEqual(arr(kms(P.selectPoints([C(0.5), C(8), C(15)], 5, 20))), [8, 15]);
});
test('Algorithmus: bis zum Ziel nichts mehr → Stopp', () => {
  assert.deepEqual(arr(kms(P.selectPoints([C(0.5)], 5, 20))), []);
  assert.deepEqual(arr(kms(P.selectPoints([], 5, 20))), []);
  // Punkt bei km ≥ L zählt nicht
  assert.deepEqual(arr(kms(P.selectPoints([C(20)], 5, 20))), []);
});
test('Algorithmus: D größer als Route → keine Punkte', () => {
  assert.deepEqual(arr(kms(P.selectPoints([C(5), C(10), C(15)], 30, 20))), []);
  assert.deepEqual(arr(kms(P.selectPoints([C(5)], 20, 20))), []); // t == L → Stopp
});
test('Algorithmus: Tie-Breaker (200 m) geöffnet > Name > näher', () => {
  const closedNamed = C(4.9, { id: 'a', openState: 'closed', hasName: true });
  const open = C(4.75, { id: 'b', openState: 'open' });
  assert.equal(P.selectPoints([closedNamed, open], 5, 8)[0].id, 'b');
  const named = C(4.85, { id: 'n', hasName: true, distM: 200 });
  const noname = C(4.95, { id: 'x', hasName: false, distM: 10 });
  assert.equal(P.selectPoints([named, noname], 5, 8)[0].id, 'n');
  const near = C(4.85, { id: 'near', distM: 10 });
  const far = C(4.95, { id: 'far', distM: 250 });
  assert.equal(P.selectPoints([near, far], 5, 8)[0].id, 'near');
  // > 200 m auseinander: kein Tie-Break, größter km gewinnt
  const o2 = C(4.7, { id: 'o2', openState: 'open' });
  const c2 = C(4.95, { id: 'c2', openState: 'closed' });
  assert.equal(P.selectPoints([o2, c2], 5, 8)[0].id, 'c2');
});
/* ===== Abfrage folgt dem Algorithmus (selectPointsLazy) ===== */
// Simuliert die App: Kandidaten sind nur sichtbar, wenn ihr Abschnitt abgefragt wurde.
function simulateLazy(candKms, D, L, segKm = 10) {
  const segs = [];
  for (let a = 0; a < L; a += segKm) segs.push({ fromKm: a, toKm: Math.min(L, a + segKm) });
  const all = candKms.map(k => C(k));
  const fetched = new Set(), order = [];
  for (let guard = 0; guard < 100; guard++) {
    const visible = all.filter(c => [...fetched].some(k => c.km >= segs[k].fromKm && c.km <= segs[k].toKm));
    const r = P.selectPointsLazy(visible, D, L, segs, k => fetched.has(k));
    if (r.need < 0) return { sel: arr(kms(r.sel)), order, full: arr(kms(P.selectPoints(all, D, L))) };
    fetched.add(r.need); order.push(r.need);
  }
  throw new Error('Endlosschleife');
}
test('Lazy: identisch mit selectPoints bei vollständigen Daten (500 Zufallsfälle)', () => {
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const L = 20 + rnd() * 230, D = 3 + rnd() * 60, n = Math.floor(rnd() * 40);
    const cands = Array.from({ length: n }, (_, j) => C(+(rnd() * L).toFixed(3), { id: 'r' + j, openState: ['open', 'closed', 'unknown'][j % 3], hasName: rnd() > 0.5, distM: rnd() * 300 }));
    const segs = []; for (let a = 0; a < L; a += 10) segs.push({ fromKm: a, toKm: Math.min(L, a + 10) });
    const a = arr(P.selectPoints(cands, D, L).map(c => c.id));
    const b = arr(P.selectPointsLazy(cands, D, L, segs, () => true).sel.map(c => c.id));
    assert.deepEqual(b, a, 'Fall ' + i + ' L=' + L + ' D=' + D);
  }
});
test('Lazy: Simulation liefert dieselbe Auswahl wie die Vollabfrage (300 Zufallsfälle)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const L = 20 + rnd() * 230, D = 3 + rnd() * 60;
    const ks = Array.from({ length: Math.floor(rnd() * 40) }, () => +(rnd() * L).toFixed(3));
    const r = simulateLazy(ks, D, L);
    assert.deepEqual(r.sel, r.full, 'Fall ' + i);
  }
});
test('Lazy: Wasser 50 km auf 64 km – nur Abschnitt bei km 40–50 wird abgefragt', () => {
  const r = simulateLazy([3, 12, 25, 45, 58], 50, 64);
  assert.deepEqual(r.order, [4]);
  assert.deepEqual(r.sel, [45]);
});
test('Lazy: rückwärts Abschnitt für Abschnitt bis zum ersten Treffer', () => {
  const r = simulateLazy([25, 58], 50, 64);
  assert.deepEqual(r.order, [4, 3, 2]);
  assert.deepEqual(r.sel, [25]);
});
test('Lazy: leeres Fenster → danach vorwärts, Rest nicht abgefragt', () => {
  const r = simulateLazy([55], 50, 64);
  assert.deepEqual(r.order, [4, 3, 2, 1, 0, 5]);
  assert.deepEqual(r.sel, [55]);
});
test('Lazy: D größer als Route → keine Abfrage', () => {
  assert.deepEqual(simulateLazy([5, 10], 80, 64).order, []);
});
test('Lazy: Tie-Breaker über Abschnittsgrenze lädt Vorabschnitt', () => {
  const r = simulateLazy([40.1], 50, 64);
  assert.deepEqual(r.order, [4, 3]);
});
test('Lazy: orientSegments für umgekehrte Route', () => {
  const segs = [{ fromKm: 0, toKm: 10 }, { fromKm: 10, toKm: 20 }, { fromKm: 20, toKm: 25 }];
  const r = arr(P.orientSegments(segs, 25, true).map(s => [s.fromKm, s.toKm, s.orig].join('/')));
  assert.deepEqual(r, ['0/5/2', '5/15/1', '15/25/0']);
});

test('Abfrage: Linienvereinfachung hält Toleranz ein und kürzt stark', () => {
  // Zickzack-Linie mit 10-m-Ausschlägen auf 10 km → fast alles entfällt bei 25 m Toleranz
  const pts = Array.from({ length: 101 }, (_, i) => F.posAt(i * 0.1, i % 2 ? 10 : 0));
  const simp = P.simplifyPath(pts, 25);
  assert.ok(simp.length <= 3, 'Punkte: ' + simp.length);
  const tr = P.buildTrack(simp);
  for (const p of pts) assert.ok(P.projectToTrack(tr, p.lat, p.lon, 26), 'Punkt außerhalb der Toleranz');
  // echte Kurve bleibt erhalten
  const L = [F.posAt(0), F.posAt(5), F.posAt(5, 2000), F.posAt(10, 2000)];
  assert.equal(P.simplifyPath(L, 25).length, 4);
});
test('Abfrage: nur gewünschte Typen, around-Korridor, out center tags', () => {
  const line = [F.posAt(0), F.posAt(10)];
  const bbox = { s: 47.9, w: 10.9, n: 48.1, e: 11.2 };
  const q = P.buildOverpassQuery(['water'], bbox, line, 350);
  assert.ok(q.startsWith('[out:json][timeout:50][bbox:47.90000,10.90000,48.10000,11.20000];'));
  assert.ok(q.includes('nwr["amenity"~"^(drinking_water|water_point)$"](around:350,48.00000,11.00000,48.00000,11.13425);'));
  assert.ok(q.includes('"man_made"="water_tap"') && q.includes('"natural"="spring"'));
  assert.ok(!q.includes('shop') && !q.includes('fuel') && !q.includes('restaurant'));
  assert.ok(q.trim().endsWith('out center tags;'));
  const q2 = P.buildOverpassQuery(['shop', 'fuel'], bbox, line, 350);
  assert.ok(q2.includes('"shop"~') && q2.includes('"vending_machine"') && q2.includes('"amenity"="fuel"') && !q2.includes('drinking_water'));
  // jede Mock-Kategorie wird von einem Filter ihres Typs abgedeckt (Abgleich mit classifyOsm)
  for (const el of F.mockOverpassElements()) {
    const c = P.classifyOsm(el.tags);
    if (!c) continue;
    const ok = P.OVERPASS_FILTERS[c.type].some(f => [...f.matchAll(/\["([^"]+)"(?:(=|~)"([^"]+)")?\]/g)]
      .every(m => el.tags[m[1]] !== undefined && (!m[2] || (m[2] === '=' ? el.tags[m[1]] === m[3] : new RegExp(m[3]).test(el.tags[m[1]])))));
    assert.ok(ok, 'kein Filter für ' + JSON.stringify(el.tags));
  }
});

test('MVT-Decoder: beschädigte Kacheln werfen Fehler statt zu hängen', () => {
  const t0 = Date.now();
  const bad = [
    new Uint8Array([0x1a, 0xff, 0xff, 0xff, 0xff, 0x0f]),          // Layer mit riesiger Länge
    new Uint8Array([0x1a, 0x05, 0x0a, 0x03, 0x70, 0x6f]),          // abgeschnitten
    new Uint8Array([0x1a, 0x08, 0x0a, 0x03, 0x70, 0x6f, 0x69, 0x12, 0x01, 0xff]), // poi-Feature mit unvollständigem Varint
    new Uint8Array(Array(20).fill(0xff)),                          // endloses Varint
  ];
  for (const b of bad) assert.throws(() => P.decodeMvtLayer(b, 'poi'), /beschädigt|Wire/);
  assert.ok(Date.now() - t0 < 500, 'zu langsam');
  assert.equal(P.decodeMvtLayer(new Uint8Array(0), 'poi'), null); // leere Kachel ist ok
});
test('GPX-Textprüfung: Präfixe und Kommentare werden erkannt', () => {
  const ok = { kind: 'trk', rawCount: 201 };
  assert.equal(P.checkGpxText(F.makeTestGpx(), ok), null);
  const pre = '<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1"><gpx:trk><gpx:trkseg><gpx:trkpt lat="1" lon="1"/></gpx:trkseg></gpx:trk></gpx:gpx>';
  assert.match(P.checkGpxText(pre, { kind: 'trk', rawCount: 1 }), /Präfix/);
  const com = F.makeTestGpx().replace('<trk>', '<!-- <trkpt lat="0" lon="0"/> -->\n  <trk>');
  assert.match(P.checkGpxText(com, ok), /Ungewöhnlicher GPX-Aufbau/);
  // Garmin-Erweiterungen mit Präfix sind erlaubt
  const ext = F.makeTestGpx().replace('<ele>500.0</ele>', '<ele>500.0</ele><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>');
  assert.equal(P.checkGpxText(ext, ok), null);
});
test('Dedupe: zwei verschiedene Läden nebeneinander bleiben, Doppelerfassung wird entfernt', () => {
  const aldi = { id: 'n1', type: 'shop', name: 'Aldi', ...F.posAt(5, 0), source: 'overpass' };
  const lidl = { id: 'n2', type: 'shop', name: 'Lidl', ...F.posAt(5.03, 0), source: 'overpass' };
  const aldiWay = { id: 'w1', type: 'shop', name: 'ALDI', ...F.posAt(5.02, 10), source: 'overpass' };
  const tile = { id: 't1', type: 'shop', name: 'Lidl Filiale', ...F.posAt(5.031, 0), source: 'tiles' };
  const r = arr(P.dedupe([aldi, lidl, aldiWay, tile], 60).map(x => x.id).sort());
  assert.deepEqual(r, ['n1', 'n2']);
});

test('Lücken: longestGap inkl. Start und Ziel', () => {
  const g = P.longestGap([4.5, 6, 19], 20);
  assert.ok(Math.abs(g.gap - 13) < 1e-9 && g.fromKm === 6 && g.toKm === 19);
  assert.equal(P.longestGap([], 20).gap, 20);
});

/* ===== Geometrie / Daten ===== */
const pts = F.testPoints();
const track = P.buildTrack(pts);
test('Geometrie: Routenlänge ~20 km', () => assert.ok(Math.abs(track.length - 20) < 0.05, 'L=' + track.length));
test('Geometrie: Projektion – km und senkrechter Abstand', () => {
  const p = F.posAt(7.33, 120);
  const r = P.projectToTrack(track, p.lat, p.lon, 300);
  assert.ok(Math.abs(r.km - 7.33) < 0.02, 'km=' + r.km);
  assert.ok(Math.abs(r.distM - 120) < 2, 'dist=' + r.distM);
  assert.equal(P.projectToTrack(track, F.posAt(7, 400).lat, F.posAt(7, 400).lon, 300), null);
});
test('Geometrie: Anstieg > 0', () => assert.ok(track.ascent > 50 && track.ascent < 200, 'ascent=' + track.ascent));
test('Segmente: ~10 km mit erweiterter BBox', () => {
  const segs = P.splitSegments(track, 10, 800);
  assert.equal(segs.length, 2);
  assert.ok(segs[0].bbox.s < 48.0 - 0.007 && segs[0].bbox.n > 48.0 + 0.007);
});
test('Klassifizierung: Regeln & Ausschlüsse', () => {
  const c = t => { const r = P.classifyOsm(t); return r ? r.type + ':' + r.label : null; };
  assert.equal(c({ amenity: 'drinking_water' }), 'water:Trinkwasser');
  assert.equal(c({ amenity: 'water_point' }), 'water:Trinkwasser');
  assert.equal(c({ man_made: 'water_tap' }), 'water:Trinkwasser');
  assert.equal(c({ man_made: 'water_tap', drinking_water: 'no' }), null);
  assert.equal(c({ man_made: 'water_tap', access: 'private' }), null);
  assert.equal(c({ amenity: 'fountain' }), null);
  assert.equal(c({ amenity: 'fountain', drinking_water: 'yes' }), 'water:Brunnen');
  assert.equal(c({ natural: 'spring' }), null);
  assert.equal(c({ natural: 'spring', drinking_water: 'yes' }), 'water:Quelle');
  assert.equal(c({ shop: 'supermarket' }), 'shop:Supermarkt');
  assert.equal(c({ shop: 'convenience' }), 'shop:Laden');
  assert.equal(c({ shop: 'bakery' }), 'shop:Bäckerei');
  assert.equal(c({ shop: 'kiosk' }), 'shop:Kiosk');
  assert.equal(c({ shop: 'butcher' }), 'shop:Metzgerei');
  assert.equal(c({ shop: 'farm' }), 'shop:Hofladen');
  assert.equal(c({ shop: 'clothes' }), null);
  assert.equal(c({ amenity: 'vending_machine', vending: 'drinks;sweets' }), 'shop:Automat');
  assert.equal(c({ amenity: 'vending_machine', vending: 'milk' }), 'shop:Automat');
  assert.equal(c({ amenity: 'vending_machine', vending: 'parking_tickets' }), null);
  assert.equal(c({ amenity: 'restaurant' }), 'food:Restaurant');
  assert.equal(c({ amenity: 'biergarten' }), 'food:Restaurant');
  assert.equal(c({ amenity: 'cafe' }), 'food:Café');
  assert.equal(c({ amenity: 'fast_food' }), 'food:Imbiss');
  assert.equal(c({ amenity: 'fuel', name: 'Aral' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'fuel', name: 'Kundentankstelle' }), null);
  assert.equal(c({ amenity: 'fuel', access: 'customers' }), null);
  assert.equal(c({ amenity: 'fuel', 'payment:dkv': 'yes', 'payment:uta': 'yes' }), null);
  assert.equal(c({ amenity: 'fuel', 'payment:dkv': 'yes', 'payment:cash': 'yes' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'charging_station' }), null);
});
test('Klassifizierung (M2): öffentliche Markentankstelle mit Flottenkarten bleibt', () => {
  const c = t => { const r = P.classifyOsm(t); return r ? r.type + ':' + r.label : null; };
  // häufiges OSM-Tagging: payment:dkv=yes ohne payment:cash
  assert.equal(c({ amenity: 'fuel', name: 'Aral', brand: 'Aral', operator: 'Aral AG', 'payment:dkv': 'yes', opening_hours: '24/7' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'fuel', name: 'Shell', 'brand:wikidata': 'Q110716465', 'payment:uta': 'yes', 'payment:routex': 'yes' }), 'fuel:Tankstelle');
  // ausdrückliche Belege weiterhin ausgeschlossen
  assert.equal(c({ amenity: 'fuel', brand: 'Aral', 'payment:dkv': 'yes', 'payment:cash': 'no' }), null);
  assert.equal(c({ amenity: 'fuel', name: 'Tankpunkt', 'payment:dkv': 'yes', 'payment:uta': 'yes' }), null);
  assert.equal(c({ amenity: 'fuel', brand: 'Aral', 'payment:dkv': 'yes', access: 'customers' }), null);
});
test('Klassifizierung (m3): "LKW"/"truck" schließt nur im Namen aus', () => {
  const c = t => { const r = P.classifyOsm(t); return r ? r.type + ':' + r.label : null; };
  assert.equal(c({ amenity: 'fuel', name: 'Shell', brand: 'Shell', description: 'mit LKW-Waschanlage' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'fuel', name: 'Esso', note: 'truck parking behind the shop' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'fuel', name: 'Agip', operator: 'Truck & Car Service GmbH' }), 'fuel:Tankstelle');
  assert.equal(c({ amenity: 'fuel', name: 'LKW-Tankstelle Müller' }), null);
  assert.equal(c({ amenity: 'fuel', name: 'Truck Stop Diesel' }), null);
  // die übrigen Ausschlüsse prüfen weiterhin alle Textfelder
  assert.equal(c({ amenity: 'fuel', name: 'Tankstelle', description: 'nur mit Karte' }), null);
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'fuel', name: 'LKW Tankstelle' }), null);
});
test('Vektor-Tiles: subclass-Mapping (Ladesäulen ausgeschlossen)', () => {
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'fuel' }).type, 'fuel');
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'charging_station' }), null);
  // m4: Namens-Ausschlüsse gelten auch im Kachel-Fallback
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'fuel', name: 'Kundentankstelle Raiffeisen' }), null);
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'fuel', name: 'Tankstelle', 'name:de': 'Betriebstankstelle Stadtwerke' }), null);
  assert.equal(P.classifyTilePoi({ class: 'fuel', subclass: 'fuel', name: 'Aral' }).type, 'fuel');
  assert.equal(P.classifyTilePoi({ class: 'shop', subclass: 'supermarket', name: 'Kunden-Center Markt' }).type, 'shop');
  assert.equal(P.classifyTilePoi({ class: 'grocery', subclass: 'supermarket' }).label, 'Supermarkt');
  assert.equal(P.classifyTilePoi({ class: 'drinking_water', subclass: 'drinking_water' }).type, 'water');
  assert.equal(P.classifyTilePoi({ class: 'beer', subclass: 'biergarten' }).type, 'food');
});
test('MVT-Decoder: handkodierte Kachel', () => {
  // Protobuf von Hand: Layer "poi", extent 4096, 1 Feature (Punkt 2048/1024), Tags class=cafe, name=Café Ä
  const enc = new TextEncoder();
  const varint = n => { const o = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return o; };
  const ld = (field, bytes) => [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
  const vi = (field, n) => [...varint(field << 3), ...varint(n)];
  const zz = n => (n << 1) ^ (n >> 31);
  const str = s => [...enc.encode(s)];
  const geom = [...varint((1 & 7) | (1 << 3)), ...varint(zz(2048)), ...varint(zz(1024))];
  const feature = [...vi(1, 7), ...ld(2, [0, 0, 1, 1, 2, 2]), ...vi(3, 1), ...ld(4, geom)];
  const layer = [...vi(15, 2), ...ld(1, str('poi')), ...ld(2, feature),
    ...ld(3, str('class')), ...ld(3, str('name')), ...ld(3, str('rank')),
    ...ld(4, ld(1, str('cafe'))), ...ld(4, ld(1, str('Café Ä'))), ...ld(4, vi(4, 13)), ...vi(5, 4096)];
  const other = [...ld(1, str('water'))];
  const tile = new Uint8Array([...ld(3, other), ...ld(3, layer)]);
  const L = P.decodeMvtLayer(tile, 'poi');
  assert.equal(L.extent, 4096);
  assert.equal(L.features.length, 1);
  assert.equal(L.features[0].props.class, 'cafe');
  assert.equal(L.features[0].props.name, 'Café Ä');
  assert.equal(L.features[0].props.rank, 13);
  assert.deepEqual(arr(L.features[0].points[0]), [2048, 1024]);
  const ll = P.tilePointToLonLat(8716, 5683, 14, 2048, 2048, 4096);
  const t = P.lonLatToTile(ll.lon, ll.lat, 14);
  assert.equal(t.x, 8716); assert.equal(t.y, 5683);
});
// Echte Kachel (optional, falls vorher heruntergeladen): PSP_TILE=/pfad/zur/kachel.pbf
if (process.env.PSP_TILE && fs.existsSync(process.env.PSP_TILE)) {
  test('MVT-Decoder: echte OpenFreeMap-Kachel', () => {
    const L = P.decodeMvtLayer(new Uint8Array(fs.readFileSync(process.env.PSP_TILE)), 'poi');
    assert.ok(L && L.features.length > 10);
    assert.ok(L.features.some(f => P.classifyTilePoi(f.props)));
  });
}
test('Dedupe: gleicher Typ < 60 m, Overpass bevorzugt', () => {
  const a = { type: 'shop', ...F.posAt(5, 0), source: 'tiles', id: 't' };
  const b = { type: 'shop', ...F.posAt(5.03, 0), source: 'overpass', id: 'o' };
  const c = { type: 'food', ...F.posAt(5, 0), source: 'tiles', id: 'f' };
  const d = { type: 'shop', ...F.posAt(5.2, 0), source: 'tiles', id: 'far' };
  const r = P.dedupe([a, b, c, d], 60).map(x => x.id).sort();
  assert.deepEqual(arr(r), ['f', 'far', 'o']);
});
if (OH) {
  test('Öffnungszeiten: Intervalle, 24h, zu, ?', () => {
    const mo = new Date(2026, 10, 23); // Montag
    const su = new Date(2026, 10, 22); // Sonntag
    const h = v => P.hoursForDay(OH, v, 48, 11, mo).text;
    assert.equal(h('Mo-Sa 08:00-22:00'), '8:00-22:00');
    assert.equal(h('Mo-Fr 07:00-12:00,14:00-18:30'), '7:00-12:00,14:00-18:30');
    assert.equal(h('24/7'), '24h');
    assert.equal(h('Mo off; Tu-Su 9-18'), 'zu');
    assert.equal(h('kaputt xyz'), '?');
    assert.equal(h(undefined), '?');
    assert.equal(P.hoursForDay(OH, 'Mo-Sa 08:00-20:00', 48, 11, su).text, 'zu');
    assert.equal(P.hoursForDay(OH, 'Mo-Fr 08:00-20:00', 48, 11, mo).state, 'open');
    assert.equal(P.hoursForDay(null, 'Mo-Fr 08:00-20:00', 48, 11, mo).text, '?');
  });
}

/* ===== 4. Namensformat ===== */
test('Namensformat exakt wie Beispiele', () => {
  assert.equal(P.wptName('Aral', 'Tankstelle', 52.3, '8:00-22:00'), 'Aral (Tankstelle), 52km, 8:00-22:00');
  assert.equal(P.wptName('Netto', 'Supermarkt', 75.6, '?'), 'Netto (Supermarkt), 76km, ?');
  assert.equal(P.wptName('Trinkbrunnen', 'Trinkwasser', 89.4, '–'), 'Trinkbrunnen (Trinkwasser), 89km, –');
  assert.equal(P.wptName('', 'Bäckerei', 4.2, '?'), 'Bäckerei (Bäckerei), 4km, ?');
});
test('XML-Escaping', () => assert.equal(P.xmlEscape(`A&B <c> "d" 'e' Ä`), 'A&amp;B &lt;c&gt; &quot;d&quot; &apos;e&apos; Ä'));
test('Dateiname', () => {
  assert.equal(P.exportFilename('Tour.gpx', false), 'Tour_Verpflegung.gpx');
  assert.equal(P.exportFilename('Tour.GPX', true), 'Tour_retour_Verpflegung.gpx');
});
test('Markdown-Tabelle (Obsidian)', () => {
  const md = P.markdownTable([{ km: 9.2, label: 'Supermarkt', name: 'A|B', hours: '7:00-21:00', distM: 80.4 },
    { km: 3.1, label: 'Trinkwasser', name: '', hours: '–', distM: 50 }]).split('\n');
  assert.equal(md[0], '| km | Typ | Name | Öffnungszeiten | Abstand |');
  assert.ok(/^\|[-:|]+\|$/.test(md[1]));
  assert.equal(md[2], '| 3 | Trinkwasser | Trinkwasser | – | 50 m |');
  assert.equal(md[3], '| 9 | Supermarkt | A\\|B | 7:00-21:00 | 80 m |');
  assert.equal(md.length, 4);
});

/* ===== Pipeline mit Mock-Overpass + Export ===== */
function pipeline(trk, reversedDate = new Date(2026, 10, 23)) {
  const D = { water: 15, shop: 6, food: 8, fuel: 8 };
  const raw = [];
  const seen = new Set();
  for (const el of F.mockOverpassElements()) {
    const cls = P.classifyOsm(el.tags);
    if (!cls) continue;
    const lat = el.lat ?? el.center.lat, lon = el.lon ?? el.center.lon;
    raw.push({ id: el.type + '/' + el.id, lat, lon, tags: el.tags, source: 'overpass', ...cls, name: P.osmName(el.tags) });
    seen.add(el.id);
  }
  const deduped = P.dedupe(raw, 60);
  const cands = [];
  for (const r of deduped) {
    const pr = P.projectToTrack(trk, r.lat, r.lon, 300);
    if (!pr) continue;
    const h = r.type === 'water' ? { text: '–', state: 'open' } : P.hoursForDay(OH, r.tags.opening_hours, r.lat, r.lon, reversedDate);
    cands.push({ ...r, km: pr.km, distM: pr.distM, hours: h.text, openState: h.state, hasName: !!r.name });
  }
  const sel = [];
  for (const t of P.TYPE_ORDER) sel.push(...P.selectPoints(cands.filter(c => c.type === t), D[t], trk.length));
  return { raw, deduped, cands, sel };
}
const gpx = F.makeTestGpx();
const fwd = pipeline(track);
test('Pipeline: Filter (Ausschlüsse, Off-Track, Dedupe)', () => {
  assert.equal(fwd.raw.length, 11);           // 16 Mock-Elemente − 5 ausgeschlossen
  assert.equal(fwd.deduped.length, 10);       // Kiosk-Duplikat entfernt
  assert.equal(fwd.cands.length, 9);          // Quelle 600 m entfernt
  const names = fwd.sel.map(c => c.type + '@' + Math.round(c.km)).sort();
  // water D=15: Fenster [3,15] → 14.6 → p=14.6, t=29.6 ≥ 20 Stopp
  // shop  D=6 : [1.2,6] → 4 ; [5.2,10] → 9 ; [10.2,15] leer → vorwärts 17 ; t=23 Stopp
  // food  D=8 : [1.6,8] leer → vorwärts 10 ; [11.6,18] → 15 ; t=23 Stopp
  // fuel  D=8 : [1.6,8] leer → 11 ; t=19, [12.6,19] leer, vorwärts nichts → Stopp
  assert.deepEqual(arr(names), ['food@10', 'food@15', 'fuel@11', 'shop@17', 'shop@4', 'shop@9', 'water@15'].sort());
});

const exportFwd = P.buildExport({ text: gpx, reversed: false, removeExisting: false, points: fwd.sel, dateLabel: 'Mo., 23.11.2026' });
test('Export: Wegpunkte vor <trk>, Track byte-identisch', () => {
  const iTrk = exportFwd.indexOf('<trk>');
  const wpts = [...exportFwd.matchAll(/<wpt /g)].map(m => m.index);
  assert.equal(wpts.length, fwd.sel.length + 1); // + vorhandener
  assert.ok(wpts.every(i => i < iTrk));
  assert.equal(exportFwd.slice(iTrk), gpx.slice(gpx.indexOf('<trk>')));
  assert.equal(exportFwd.slice(0, exportFwd.indexOf('<wpt')), gpx.slice(0, gpx.indexOf('<wpt')));
  assert.ok(exportFwd.includes('<name>Aral (Tankstelle), 11km, ' + (OH ? '8:00-22:00' : '?') + '</name>'));
  assert.ok(exportFwd.includes('<name>Dorfbrunnen (Brunnen), 15km, –</name>'));
  assert.ok(exportFwd.includes('<name>Bäckerei (Bäckerei), 4km, ' + (OH ? '6:00-18:00' : '?') + '</name>'));
  assert.ok(exportFwd.includes('Gasthof &quot;Ä&amp;Ö&quot; &lt;Test&gt; (Restaurant), 10km'));
  assert.ok(exportFwd.includes('<sym>Gas Station</sym>') && exportFwd.includes('<type>Tankstelle</type>'));
  assert.ok(/<desc>[^<]*im Winter evtl\. abgestellt<\/desc>/.test(exportFwd));
  // Wegpunkte nach km sortiert
  const wkm = [...exportFwd.matchAll(/<name>[^<]*, (\d+)km, /g)].map(m => +m[1]);
  assert.deepEqual(wkm, wkm.slice().sort((a, b) => a - b));
});
test('Export: vorhandene Wegpunkte entfernen', () => {
  const out = P.buildExport({ text: gpx, reversed: false, removeExisting: true, points: fwd.sel, dateLabel: 'x' });
  assert.ok(!out.includes('Alter Wegpunkt'));
  assert.equal([...out.matchAll(/<wpt /g)].length, fwd.sel.length);
  assert.equal(out.slice(out.indexOf('<trk>')), gpx.slice(gpx.indexOf('<trk>')));
});

/* ===== 3. Umgekehrter Export ===== */
const revTrack = P.buildTrack(pts.slice().reverse());
const rev = pipeline(revTrack);
const exportRev = P.buildExport({ text: gpx, reversed: true, removeExisting: false, points: rev.sel, dateLabel: 'x' });
test('Umkehrung: Trackpunkte umgekehrt, keine <time>', () => {
  const ptsOf = s => [...s.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">\s*<ele>([^<]+)<\/ele>/g)].map(m => m[1] + ',' + m[2] + ',' + m[3]);
  const a = ptsOf(gpx), b = ptsOf(exportRev);
  assert.equal(a.length, 201);
  assert.deepEqual(b, a.slice().reverse());
  assert.ok(!/<time/.test(exportRev), 'time gefunden');
  assert.ok(exportRev.includes('Alter Wegpunkt'));
  // Formatierung bleibt erhalten (Einrückung der trkpt)
  const lastPt = gpx.slice(gpx.lastIndexOf('      <trkpt'), gpx.indexOf('</trkpt>', gpx.lastIndexOf('      <trkpt')));
  const firstRev = exportRev.slice(exportRev.indexOf('      <trkpt'), exportRev.indexOf('</trkpt>', exportRev.indexOf('      <trkpt')));
  assert.equal(firstRev, lastPt.replace(/\n\s*<time>[^<]*<\/time>/, ''));
});
test('Umkehrung: Wegpunkt-km ab neuem Start', () => {
  const L = revTrack.length;
  for (const c of rev.sel) {
    const orig = fwd.cands.find(x => x.id === c.id) || pipeline(track).cands.find(x => x.id === c.id);
    assert.ok(Math.abs(c.km - (L - orig.km)) < 0.02, c.id + ': ' + c.km + ' vs ' + (L - orig.km));
  }
  // Aral (orig km 11) → retour km 9
  assert.ok(exportRev.includes('Aral (Tankstelle), 9km, '));
  assert.ok(!exportRev.includes('Aral (Tankstelle), 11km, '));
});
test('Umkehrung: mehrere Segmente/Tracks, Routen, Inline-Format', () => {
  const t = '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg><trkseg><trkpt lat="3" lon="3"><time>x</time></trkpt></trkseg></trk>'
    + '<rte><rtept lat="5" lon="5"/><rtept lat="6" lon="6"/></rte></gpx>';
  assert.equal(P.reverseGpxText(t),
    '<gpx><trk><trkseg><trkpt lat="3" lon="3"></trkpt></trkseg><trkseg><trkpt lat="2" lon="2"/><trkpt lat="1" lon="1"/></trkseg></trk>'
    + '<rte><rtept lat="6" lon="6"/><rtept lat="5" lon="5"/></rte></gpx>');
});
test('Export: Route ohne <trk> → vor <rte>; kein trk/rte → vor </gpx>', () => {
  const p = [{ lat: 1, lon: 2, km: 3, distM: 4, name: 'X', label: 'Kiosk', type: 'shop', hours: '?', source: 'tiles' }];
  const a = P.insertWpts('<gpx>\n  <rte>\n  </rte>\n</gpx>', p, 'd');
  assert.ok(a.indexOf('<wpt') < a.indexOf('<rte>') && a.includes('\n  <wpt') && a.includes('\n  <rte>'));
  const b = P.insertWpts('<gpx>\n</gpx>', p, 'd');
  assert.ok(b.indexOf('<wpt') < b.indexOf('</gpx>'));
});
test('Encoding: ISO-8859-1 wird gelesen und als UTF-8 deklariert', () => {
  const s = '<?xml version="1.0" encoding="ISO-8859-1"?><gpx><trk><name>München</name></trk></gpx>';
  const bytes = Uint8Array.from(s, ch => ch.charCodeAt(0));
  const d = P.decodeFile(bytes);
  assert.ok(d.text.includes('München'));
  assert.ok(P.forceUtf8Declaration(d.text).startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});

test('Offline-Daten: gridKey / gridKeysForBbox (Zellgrenzen, negative Koordinaten)', () => {
  assert.equal(P.EXTRACT_PER_DEG, 10);
  assert.equal(P.gridKey(47.37, 8.54), '473_85');
  assert.equal(P.gridKey(47.3, 8.5), '473_85');            // Untergrenze gehört zur Zelle
  assert.equal(P.gridKey(-0.05, -0.05), '-1_-1');
  const keys = P.gridKeysForBbox({ s: 47.29, n: 47.31, w: 8.59, e: 8.61 });
  assert.deepEqual([...keys].sort(), ['472_85', '472_86', '473_85', '473_86']);
  assert.deepEqual([...P.gridKeysForBbox({ s: 47.31, n: 47.32, w: 8.51, e: 8.52 })], ['473_85']);
});
test('Offline-Daten: pack/unpack ergibt denselben Punkt wie Overpass', () => {
  const el = { id: 'way/42', lat: 47.123456, lon: 8.654321, tags: { shop: 'bakery', name: 'Beck', opening_hours: 'Mo-Fr 06:00-18:00', 'addr:country': 'CH', foo: 'bar' } };
  const cls = P.classifyOsm(el.tags);
  const row = P.packExtractPoint(el, cls);
  assert.deepEqual(JSON.parse(JSON.stringify(row)), ['w42', 47.12346, 8.65432, 'shop', 'Bäckerei', 'Beck', 'Mo-Fr 06:00-18:00', 'CH']);
  const p = P.unpackExtractPoint(row, '2026-11-24');
  assert.equal(p.id, 'way/42'); assert.equal(p.source, 'extract'); assert.equal(p.type, 'shop');
  assert.equal(p.tags.opening_hours, 'Mo-Fr 06:00-18:00'); assert.equal(p.tags['addr:country'], 'CH'); assert.equal(p.osmDate, '2026-11-24');
  // leere Felder am Ende werden weggelassen
  const w = P.packExtractPoint({ id: 'node/7', lat: 1, lon: 2, tags: { amenity: 'drinking_water' } }, { type: 'water', label: 'Trinkwasser' });
  assert.deepEqual(JSON.parse(JSON.stringify(w)), ['n7', 1, 2, 'water', 'Trinkwasser']);
  assert.equal(P.unpackExtractPoint(w).name, '');
  // ungültige Zeilen → null
  for (const bad of [null, [], ['x7', 1, 2, 'water', 'T'], ['n7', 'a', 2, 'water', 'T'], ['n7', 1, 2, 'beer', 'T']])
    assert.equal(P.unpackExtractPoint(bad), null);
});
test('Offline-Daten: Dedupe bevorzugt sie vor Vektor-Tiles, Quelle im Export', () => {
  const a = { id: 'tile/1', type: 'shop', lat: 47, lon: 8, source: 'tiles', name: 'Coop' };
  const b = { id: 'node/1', type: 'shop', lat: 47.0001, lon: 8, source: 'extract', name: 'Coop' };
  const kept = P.dedupe([a, b], 60);
  assert.equal(kept.length, 1); assert.equal(kept[0].source, 'extract');
  assert.match(P.wptDesc({ hours: '?', distM: 5, source: 'extract', osmDate: '2026-11-24', type: 'shop' }, 'd'), /OSM \(Offline-Daten\), Stand 2026-11-24/);
  assert.equal(P.sourceInfo('extract').tags, true); assert.equal(P.sourceInfo('tiles').tags, false);
});

test('Filter „nur offen“: nur geöffnete, Wasser nie gefiltert, aus = alles', () => {
  const f = P.passesOpenFilter;
  assert.equal(f({ type: 'food', openState: 'open' }, true), true);
  assert.equal(f({ type: 'food', openState: 'closed' }, true), false);
  assert.equal(f({ type: 'shop', openState: 'unknown' }, true), false);
  assert.equal(f({ type: 'water', openState: 'unknown' }, true), true);
  assert.equal(f({ type: 'fuel', openState: 'closed' }, false), true);
});

// Fixtures für manuelle Tests schreiben
fs.mkdirSync(path.join(here, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(here, 'fixtures', 'test-route.gpx'), gpx);
fs.writeFileSync(path.join(here, 'fixtures', 'overpass-mock.json'),
  JSON.stringify({ version: 0.6, generator: 'PitStopPlanner-Mock', elements: F.mockOverpassElements() }, null, 1));

// ---- Ausgabe ----
let fail = 0;
for (const [ok, name, err] of results) {
  console.log((ok ? '✔ ' : '✘ ') + name + (ok ? '' : '\n    → ' + err));
  if (!ok) fail++;
}
console.log('\n' + (results.length - fail) + '/' + results.length + ' Tests bestanden' + (OH ? '' : ' (Öffnungszeiten übersprungen)'));
process.exit(fail ? 1 : 0);
