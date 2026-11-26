# PitStopPlanner

**Verpflegungspunkte entlang einer GPX-Route finden und als Wegpunkte exportieren.**
*Find water, shops, cafés and petrol stations along a GPX route and export them as waypoints (German UI).*

👉 **Online nutzen:** https://kloeggaa.github.io/pitstopplanner/

## Was es macht

1. GPX-Datei laden (z. B. Komoot-Export) – Track oder Route, Länge und Anstieg werden angezeigt.
2. Typen wählen (Wasser, Einkauf, Restaurant/Café, Tankstelle) und je Typ den **max. Abstand** zwischen zwei Stopps.
   Optional je Typ (außer Wasser) **🕒 nur offen**: automatisch gewählt werden dann nur Punkte, die laut Öffnungszeiten
   am Fahrtag geöffnet haben. Punkte ohne Öffnungszeiten bleiben als graue Kandidaten sichtbar und können manuell übernommen werden.
3. **Versorgungspunkte suchen:** Daten kommen aus OpenStreetMap – wo vorhanden aus vorberechneten
   [Offline-Daten](https://github.com/kloeggaa/pitstopplanner-data) (derzeit Schweiz, Liechtenstein, Österreich, Deutschland, Frankreich, Italien; wöchentlich aktualisiert),
   sonst über die Overpass-API (Fallback OpenFreeMap-Vektor-Tiles). Abschalten: „Offline-Daten verwenden, wo verfügbar“.
   Die Auswahl springt jeweils um den max. Abstand nach vorn und sucht von dort rückwärts den letzten Punkt davor.
   Öffnungszeiten werden für den gewählten **Fahrtag** ausgewertet.
4. Auswahl anpassen: Punkte in der Tabelle oder per Klick auf der Karte hinzufügen/entfernen.
5. **GPX herunterladen:** Original-Datei unverändert, die Stopps als `<wpt>` eingefügt – z. B.
   `Netto (Supermarkt), 76km, 7:00-21:00`. Optional umgekehrte Richtung.
   Die Liste lässt sich auch als Markdown-Tabelle (z. B. für Obsidian) kopieren.

## Für welche Routen?

Die App ist für **Strecken von A nach B** gedacht (auch Rundtouren, die sich nicht selbst kreuzen).
Nicht geeignet sind Routen, die **dieselbe Strecke mehrfach befahren** – etwa Hin- und Rückweg auf derselben Straße
oder Achter-Schleifen: Jeder Punkt wird nur dem nächstgelegenen Durchgang zugeordnet, auf dem zweiten Durchgang
fehlen die Kandidaten. Solche Routen am besten in einzelne A→B-Abschnitte teilen.

## Datenschutz & Fair Use

- Auswahl und Export laufen lokal im Browser, die GPX-Datei selbst wird nicht hochgeladen.
- **Offline-Daten** (derzeit Schweiz, Liechtenstein, Österreich, Deutschland, Frankreich, Italien): Es werden nur Gitterzellen von ca. 11 × 8 km von GitHub Pages
  (`kloeggaa.github.io/pitstopplanner-data`) geladen – der Routenverlauf wird dabei nicht gesendet. Ein Abschnitt
  nutzt sie nur, wenn alle seine Zellen vollständig innerhalb der abgedeckten Länder liegen (Grenzen zwischen zwei
  abgedeckten Ländern sind kein Problem); Abschnitte an der Außengrenze und in anderen Ländern gehen weiter an Overpass. Stand der Daten: siehe Log bzw. Wegpunkt-Beschreibung.
- **Sonst wird für die Suche der Routenverlauf** (vereinfacht auf ca. 25 m, abschnittsweise) an öffentliche Overpass-Server
  gesendet: `overpass-api.de` (Deutschland), bei Störungen ersatzweise `overpass.private.coffee` und `maps.mail.ru`
  (VK, Russland). Beginnt die Route an der eigenen Wohnung, ist diese daraus ablesbar – ggf. Start/Ende vorher kürzen.
- Im Fallback werden Vektor-Kacheln entlang der Route von OpenFreeMap geladen; die Kartenanzeige lädt Kacheln von
  OpenStreetMap bzw. OpenFreeMap.
- Overpass ist ein kostenloser, ehrenamtlich betriebener Dienst. Die App fragt deshalb nur die Abschnitte und
  Typen ab, die der Auswahl-Algorithmus wirklich braucht, nur im Korridor um die Route, wartet zwischen Anfragen,
  pausiert einen Overpass-Server nach einem Rate-Limit (HTTP 429) oder Netzwerkfehler für 2 Minuten und weicht auf
  die anderen aus; sind alle pausiert oder häufen sich Fehler, ruht Overpass 2 Minuten ganz (dann Vektor-Tiles) und
  begrenzt die Eingaben (max. 1000 m vom Track). Bitte trotzdem sparsam suchen.

## Bekannte Einschränkungen & Backlog

- **Feiertage nur für Deutschland:** Öffnungszeiten mit `PH` (Feiertag) werden nach deutschen Feiertagen ausgewertet,
  außer der Punkt hat ein `addr:country`-Tag (bei den meisten fehlt es). In der Schweiz, Österreich, Frankreich usw.
  kann ein Laden an einem dortigen Feiertag daher fälschlich als geöffnet erscheinen (z. B. Zürich am 1. August).
  Ausgewertet wird außerdem in der Zeitzone des Browsers, nicht in der des Punkts.
  *Backlog:* Land (und Bundesland/Kanton) aus den Koordinaten bestimmen, z. B. über einen kompakten Grenzdatensatz,
  und die Zeitzone des Punkts verwenden.
- **Routen mit mehrfach befahrenen Abschnitten** – siehe [Für welche Routen?](#für-welche-routen).

## Lokal nutzen

`index.html` herunterladen und per Doppelklick öffnen – kein Server, kein Build. (Ohne Webserver wird als
Hintergrundkarte OpenFreeMap verwendet, weil die OSM-Kachelserver bei `file://` keinen Referer bekommen.)

## Tests

```bash
node tests/run-tests.mjs                     # Kern-Logik (Node 18+)
chromium --headless --allow-file-access-from-files --virtual-time-budget=400000 \
  --dump-dom "file://$PWD/tests/test.html"   # Browser- und End-to-End-Tests (Overpass gemockt)
```

## Lizenz

MIT – siehe [LICENSE](LICENSE). Kartendaten © OpenStreetMap-Mitwirkende (ODbL).
