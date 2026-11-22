/*
 * Synthetische Testdaten für PitStopPlanner – nutzbar in Node (vm) und im Browser (<script src>).
 * Route: ~20 km ostwärts ab 48,0°N / 11,0°E, Punkte alle 100 m, mit <ele> und <time>,
 * einem vorhandenen <wpt> und Komoot-ähnlichem Aufbau.
 */
(function (root) {
  'use strict';
  const KM_PER_DEG_LON = 111.32 * Math.cos(48 * Math.PI / 180); // ≈ 74,49 km bei 48°N
  const LAT0 = 48.0, LON0 = 11.0;

  /** Position auf der Testroute bei km (Original-Richtung) plus Versatz nach Norden in m */
  function posAt(km, northM = 0) {
    return { lat: LAT0 + northM / 111320, lon: LON0 + km / KM_PER_DEG_LON };
  }

  function makeTestGpx() {
    const lines = [];
    lines.push("<?xml version='1.0' encoding='UTF-8'?>");
    lines.push('<gpx version="1.1" creator="https://www.komoot.de" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
    lines.push('  <metadata>');
    lines.push('    <name>Testrunde Ötztal &amp; Umgebung</name>');
    lines.push('    <time>2026-11-22T07:00:00.000Z</time>');
    lines.push('  </metadata>');
    lines.push('  <wpt lat="48.0100000" lon="11.0500000">');
    lines.push('    <name>Alter Wegpunkt</name>');
    lines.push('  </wpt>');
    lines.push('  <trk>');
    lines.push('    <name>Testrunde Ötztal &amp; Umgebung</name>');
    lines.push('    <trkseg>');
    const t0 = Date.UTC(2026, 10, 22, 8, 0, 0);
    for (let i = 0; i <= 200; i++) {
      const km = i * 0.1;
      const p = posAt(km);
      const ele = 500 + 40 * Math.sin(km / 3);
      lines.push('      <trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '">');
      lines.push('        <ele>' + ele.toFixed(1) + '</ele>');
      lines.push('        <time>' + new Date(t0 + i * 20000).toISOString() + '</time>');
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
    lines.push('  </trk>');
    lines.push('</gpx>');
    return lines.join('\n') + '\n';
  }

  /** Trackpunkte direkt (ohne XML-Parser), identisch zu makeTestGpx */
  function testPoints() {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const p = posAt(i * 0.1);
      pts.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: +(500 + 40 * Math.sin(i * 0.1 / 3)).toFixed(1) });
    }
    return pts;
  }

  /** Overpass-Mock-Antwort: Elemente an bekannten km-Positionen */
  function mockOverpassElements() {
    let id = 1000;
    const node = (km, northM, tags) => { const p = posAt(km, northM); return { type: 'node', id: id++, lat: p.lat, lon: p.lon, tags }; };
    const way = (km, northM, tags) => { const p = posAt(km, northM); return { type: 'way', id: id++, center: { lat: p.lat, lon: p.lon }, tags }; };
    return [
      // Wasser
      node(3.0, 50, { amenity: 'drinking_water', name: 'Trinkbrunnen' }),
      node(7.0, 20, { amenity: 'fountain' }),                                      // ohne drinking_water → raus
      node(8.0, 20, { man_made: 'water_tap', drinking_water: 'no' }),             // raus
      node(12.0, -30, { man_made: 'water_tap' }),
      node(14.6, 10, { amenity: 'fountain', drinking_water: 'yes', name: 'Dorfbrunnen' }),
      node(16.0, 600, { natural: 'spring', drinking_water: 'yes' }),               // 600 m weg → raus
      node(18.0, 0, { amenity: 'drinking_water', access: 'private' }),            // raus
      // Einkauf
      node(4.0, 40, { shop: 'bakery', opening_hours: 'Mo-Sa 06:00-18:00; Su 07:00-11:00' }),
      way(9.0, -80, { shop: 'supermarket', name: 'Netto', opening_hours: 'Mo-Sa 07:00-21:00' }),
      node(17.0, 30, { shop: 'kiosk', name: 'Kiosk am See' }),
      node(17.02, 30, { shop: 'kiosk', name: 'Kiosk am See' }),                    // Duplikat (~20 m) gleicher Typ
      // Restaurant
      node(10.0, 60, { amenity: 'restaurant', name: 'Gasthof "Ä&Ö" <Test>', opening_hours: 'Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 10:00-23:00' }),
      node(15.0, 15, { amenity: 'cafe', name: 'Café Sonne', opening_hours: 'Mo off; Tu-Su 09:00-18:00' }),
      // Tankstelle
      node(11.0, 25, { amenity: 'fuel', name: 'Aral', brand: 'Aral', opening_hours: 'Mo-Su 08:00-22:00' }),
      node(13.0, 25, { amenity: 'fuel', name: 'Kundentankstelle Raiffeisen' }),  // raus
      node(13.5, 25, { amenity: 'fuel', name: 'Hoftank', access: 'customers' }),  // raus
    ];
  }

  root.PSP_FIXTURES = { posAt, makeTestGpx, testPoints, mockOverpassElements, KM_PER_DEG_LON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
