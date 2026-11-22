# PitStopPlanner

**Verpflegungspunkte entlang einer GPX-Route finden und als Wegpunkte exportieren.**
*Find water, shops, cafés and petrol stations along a GPX route and export them as waypoints (German UI).*

👉 **Online nutzen:** https://kloeggaa.github.io/pitstopplanner/

## Was es macht

1. GPX-Datei laden (z. B. Komoot-Export) – Track oder Route, Länge und Anstieg werden angezeigt.
2. Typen wählen (Wasser, Einkauf, Restaurant/Café, Tankstelle) und je Typ den **max. Abstand** zwischen zwei Stopps.
3. **Versorgungspunkte suchen:** Daten kommen aus OpenStreetMap (Overpass-API, Fallback OpenFreeMap-Vektor-Tiles).
   Die Auswahl springt jeweils um den max. Abstand nach vorn und sucht von dort rückwärts den letzten Punkt davor.
   Öffnungszeiten werden für den gewählten **Fahrtag** ausgewertet.
4. Auswahl anpassen: Punkte in der Tabelle oder per Klick auf der Karte hinzufügen/entfernen.
5. **GPX herunterladen:** Original-Datei unverändert, die Stopps als `<wpt>` eingefügt – z. B.
   `Netto (Supermarkt), 76km, 7:00-21:00`. Optional umgekehrte Richtung.
   Die Liste lässt sich auch als Markdown-Tabelle (z. B. für Obsidian) kopieren.

## Datenschutz & Fair Use

- Alles läuft lokal im Browser. Die GPX-Datei wird nirgends hochgeladen; an die Overpass-Server gehen nur
  Kartenausschnitte entlang der Route.
- Overpass ist ein kostenloser, ehrenamtlich betriebener Dienst. Die App fragt deshalb nur die Abschnitte und
  Typen ab, die der Auswahl-Algorithmus wirklich braucht, wartet zwischen Anfragen und stoppt bei einem
  Rate-Limit (HTTP 429). Bitte trotzdem sparsam suchen.

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
