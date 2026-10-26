# Keks-Ausstecher aus Foto

Browser-App: Ein Foto hochladen und daraus einen **Keksausstecher** und einen passenden
**Prägestempel** als STL-Dateien für den 3D-Druck erzeugen. Das Ganze funktioniert wie die
„Foto-Ausstecher“ aus Online-Shops, nur zum Selberdrucken. Alles läuft lokal im Browser, das Foto
wird nirgendwohin hochgeladen.

## Funktionen

- **Form:** Umriss des Motivs (automatisch freigestellt) oder feste Formen (Kreis, Quadrat, Herz, Stern),
  in die das Foto per Zoom und Verschieben eingepasst wird.
- **Freistellen:** Der Hintergrund wird über die Randfarben des Fotos erkannt. Per Tippen in die Vorschau
  kommen weitere Hintergrundfarben dazu. PNGs mit Transparenz werden direkt über den Alphakanal freigestellt.
- **Stempel-Motiv:** Linienbild aus dem Foto (Konturen per Difference-of-Gaussians, dunkle Flächen per
  Schwellwert oder beides) mit Reglern für Detail, Empfindlichkeit, Linienstärke und Rauschfilter,
  auf Wunsch invertiert und mit Randlinie.
- **Maße:** Höhe, Wandstärke, Griffrand, Plattenstärke, Reliefhöhe und Spiel zwischen Stempel und
  Ausstecher sind einstellbar.
- **Vorschau** des Abdrucks in 2D und drehbares 3D-Modell.
- **Export** als binäre STL: Ausstecher, Stempel (spiegelverkehrt, damit der Abdruck seitenrichtig ist)
  oder beides in einer Datei.

## Funktionsweise

1. Foto und Umriss-Maske werden auf ein Raster mit fester Auflösung in mm gezeichnet (ca. 480 Punkte
   über die Motivgröße).
2. Aus der Maske entsteht ein vorzeichenbehaftetes Distanzfeld (exakte euklidische
   Distanztransformation, `js/raster.js`). Schneide, Griffrand, Stempelplatte und Relief sind jeweils
   Bereiche dieses Felds, zum Beispiel die Schneide als 0 ≤ Abstand ≤ Wandstärke.
3. Marching Squares erzeugt daraus subpixelgenaue Konturen, Douglas-Peucker vereinfacht sie, und
   [earcut](https://github.com/mapbox/earcut) (ISC, in `js/vendor/`) trianguliert die Deckflächen
   (`js/geometry.js`). Jede Fläche wird zu einem geschlossenen Körper extrudiert.

## Drucken

- Ausstecher mit Griffrand nach unten und Stempel mit flacher Seite nach unten drucken, ohne Stützen.
- PLA oder PETG (lebensmittelecht ausgewiesen), 0,2 mm Schichthöhe.
- 3D-Drucke sind wegen der Schichtrillen nur bedingt hygienisch: kurz verwenden, von Hand spülen,
  bei Bedarf Frischhaltefolie zwischen Stempel und Teig legen.

## Starten und testen

```bash
npm start          # im Repo-Wurzelverzeichnis, dann http://localhost:8080/ausstecher/
npm test
```

Die Tests prüfen Distanzfeld, Konturen, Polygone mit Löchern und dass Ausstecher und Stempel
geschlossene Körper mit den erwarteten Maßen sind.
