# Zeitraffer – Foto-Morphing

Jeden Tag ein Foto aufnehmen – die App macht daraus ein Zeitraffer-Video, in dem die Bilder
fließend ineinander **morphen** (nicht nur überblenden).

Die App läuft komplett im Browser: Fotos werden lokal im Gerät gespeichert (IndexedDB), das
Video wird direkt auf dem Gerät gerendert. Es gibt keinen Server und keinen Upload.

## Funktionen

- **Kamera mit Ausrichtungshilfe:** Das letzte Foto wird halbtransparent über das Livebild gelegt
  („Onion Skin“), damit jede Aufnahme gleich ausgerichtet ist. Deckkraft per Regler.
- **Import** vorhandener Fotos (Mehrfachauswahl). Das Aufnahmedatum wird aus den EXIF-Daten gelesen.
- **Galerie** mit Datum; Datum korrigieren oder Fotos löschen per Tippen.
- **Streak-Zähler** und Hinweis, ob das heutige Foto schon gemacht ist.
- **Video-Export** als MP4 (H.264) mit einstellbarem Format, Standzeit, Übergangsdauer,
  Morph-Stärke, Bildrate, Zeitraum und Datumseinblendung. Vorschau vor dem Export.
- **Installierbar als App** (PWA) und offline nutzbar.

## So funktioniert das Morphing

1. Für jedes Fotopaar wird auf verkleinerten Graustufenbildern ein dichter **optischer Fluss**
   berechnet (`js/flow.js`): Grob-nach-fein-Blockmatching über eine Bildpyramide mit
   mittelwertfreiem Vergleich (robust gegen unterschiedliche Helligkeit an verschiedenen Tagen),
   danach Median- und konfidenzgewichtete Glättung.
2. Ein WebGL2-Shader (`js/morph-gl.js`) verzerrt für jedes Zwischenbild beide Fotos entlang
   dieses Bewegungsfelds aufeinander zu und blendet sie über.
3. Die Bilder werden per **WebCodecs** mit exakten Zeitstempeln kodiert und mit
   [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, in `js/vendor/`) zu einer MP4-Datei
   zusammengesetzt – schneller als Echtzeit und unabhängig von der Geräteleistung.
   Ältere Browser ohne WebCodecs nehmen das Canvas stattdessen in Echtzeit per MediaRecorder auf.

Morph-Stärke 0 ergibt eine klassische Überblendung.

## Starten

Keine Build-Schritte nötig – es sind nur statische Dateien:

```bash
npm start            # = python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

Für die Kamera auf dem Handy wird **HTTPS** benötigt. Am einfachsten über GitHub Pages
veröffentlichen (Settings → Pages → Branch auswählen) und die Seite dann auf dem Handy
„Zum Startbildschirm hinzufügen“.

## Tests

```bash
npm test
```

Testet die Flussberechnung (Verschiebung, Helligkeitsänderung, Laufzeit).

## Hinweise

- Die Fotos liegen nur in diesem Browser auf diesem Gerät. Browserdaten löschen entfernt auch die Fotos.
- Tägliche Push-Erinnerungen sind ohne Server nicht zuverlässig möglich; die App zeigt beim Öffnen,
  ob das heutige Foto noch fehlt.
