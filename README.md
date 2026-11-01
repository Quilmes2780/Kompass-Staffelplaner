# KOMPASS – Der Staffelplaner

Browserbasiertes Management-Spiel zur Regionalliga-Reform des DFB („Kompassmodell“). Sie leiten beim DFB den
Spielbetrieb der 4. Liga und teilen Jahr für Jahr 80 Teams auf vier Staffeln à 20 auf – nach kurzen Reisewegen,
aber mit Augenmaß für Derbys, Planungssicherheit, Zweitvertretungen, Oberligen und Stakeholder.

## Schnellstart

```bash
npm install
npm run dev          # Entwicklungsserver (http://localhost:5173)
npm run build        # Typprüfung + statisches Bundle in dist/
npm run preview      # dist/ lokal ausliefern
npm test             # Vitest (Engine, Optimierer, Invarianten, 30-Saisons-Lauf, Speichern/Laden)
npm run headless -- 30 1 REAL   # Headless-Simulation: Saisons, Seed, REAL|FICTIONAL
```

`dist/` enthält alles (Stammdaten, Karte, Code) und lädt keine externen Ressourcen. Es läuft offline von jedem
statischen Webserver (`npm run preview`, `npx serve dist`, IIS, nginx …). Direktes Öffnen per `file://` wird von
Browsern für ES-Module blockiert.

## Spielablauf

Der Übergang (Qualifikationssaison 2027/28) wird vorausgesetzt: Das Spiel beginnt mit der ersten viergleisigen Saison
**2028/29**. Die Startaufstellung entsteht aus den Stammdaten 2026/27 nach den Quali-Quoten (Bayern 14, Nordost 14,
Nord 15, West 16, Südwest 17 – jeweils nach den Drittliga-Aufsteigern – plus 4 Drittliga-Absteiger).

Jahreszyklus: **Staffeleinteilung → Saison → Saisonabschluss → (alle 3 Saisons: Evaluierung) → Zwischensaison-Ereignisse
→ Zulassungsverfahren → nächste Einteilung.** Optional davor der Prolog „Bundestag 18.12.2026“ (Lobby-Minispiel,
bei Niederlage Alternativszenario 22/5-Modell). Game over, wenn nach einer Evaluierung die Rückabwicklung beschlossen wird.

## Architektur

| Pfad | Inhalt |
|---|---|
| `config/rules.ts` | alle Regelparameter, Kompassmodell + 22/5-Modell, Konsistenzprüfung `validateRules` |
| `engine/` | UI-unabhängige Simulation (headless lauffähig, keine React/DOM-Importe) |
| `engine/game.ts` | Phasen-Automat; jede Spieleraktion ist eine reine Funktion `(state, …) → state` |
| `engine/rng.ts` | mulberry32; je Entscheidung ein aus Seed + Schlüsseln abgeleiteter Stream |
| `engine/allocation/` | Optimierer (k-Medoid-Clustering mit Kapazität + Swap-Lokalsuche, Kompass-Rotation) und Kennzahlen |
| `engine/promotion.ts` | Auf-/Abstieg aller Ebenen, Kontingente, Relegation, Sonderfälle, Nachrücker |
| `engine/season.ts`, `match.ts` | Spielplan, Poisson-Spielmodell (Dixon-Coles), Zuschauer |
| `engine/licensing.ts`, `economy.ts`, `stakeholders.ts`, `events.ts`, `evaluation.ts`, `assembly.ts` | Zulassung, Finanzen, Zufriedenheit, Ereignisse, Bewertung, Bundestag |
| `engine/stats.ts`, `persistence.ts` | Historie-Auswertungen, JSON-Export/-Import, CSV |
| `src/` | React-UI, Zustand-Store, Karte (d3-geo), Speichern in IndexedDB |
| `data/` | Stammdaten (siehe unten), `data/geo/de.json` Kartengeometrie |
| `scripts/` | `headless.ts`, `extract-geo.ts` (Karte aus `world-atlas` neu erzeugen) |

**Determinismus:** Gleicher Seed + gleiche Entscheidungen = identischer Spielverlauf (getestet). Der RNG-Zustand muss
nicht gespeichert werden, weil jeder Zufallswert aus `hash(seed, saison, kontext, …)` abgeleitet wird.

**Simulationstiefe:** 3. Liga, Regionalliga und die 14 Oberligen werden Spiel für Spiel simuliert. Die Oberligen
haben weniger Spieltage und verteilen sie gleichmäßig über die Saison. Bundesliga, 2. Bundesliga und ein
Verbandsliga-Reservoir je Oberliga werden abstrakt (stärkegewichtete Rangliste) gerechnet.
Aufstiegsrunden und Relegationen der 5. Ebene sind echte Spiele.

## Datenmodell

Der komplette Spielstand ist ein JSON-Objekt `GameState` (`engine/types.ts`), ohne Klassen und Maps. Die wichtigsten Teile:

- `clubs: Record<ClubId, Club>` – Vereine mit aktuellem Stand (Stärke, Etat, Stadion …)
- `leagues` – Zugehörigkeit: `BL`, `BL2`, `L3` (Listen), `RL` (Staffel → Liste), `OL` / `VL` (Oberliga-ID → Liste)
- `allocation`, `previousAllocation`, `allocationDraft` – veröffentlichte Einteilung, Vorjahr, Arbeitsstand mit Varianten A/B/C und Härtefallanträgen
- `satisfaction` – 0–100 für jeden Verein, die Regionalverbände (`BFV`, `NOFV`, `NFV`, `WDFV`, `SW`), `FANS`, `MEDIA`, `MARKETING`, `PRAESIDIUM`
- `history.clubSeasons: ClubSeasonRecord[]` – ein Eintrag pro Verein und Saison (lückenlos): Spielklasse, Staffel, Platz,
  Bilanz, Auf-/Abstieg (`movement`), Titel, Relegation, Reise-km gesamt und pro Auswärtsspiel, Zuschauerschnitt, Einnahmen
  (Garantie, Ausschüttung, sonstige), Etat, Zulassungsstatus mit Auflagen, Härtefallanträge, Staffelwechsel, Derbys
- `history.seasons: SeasonSummary[]` – Abschlusstabellen, Einteilung und Kennzahlen, Auf-/Absteiger, Relegationen,
  Sonderfälle, Serien, Derby-Ergebnisse, Note, Akzeptanz
- `history.evaluations`, `courtCases`, `precedents`, `achievements`, `news`

## Regelparameter (`config/rules.ts`)

| Bereich | Parameter (Standard) |
|---|---|
| `rl` | Staffeln `Nord`, `Ost`, `Süd`, `West` (mit `groupBearings` für die erste Benennung), `groupSize` 20, `relegatedPerGroup` 4, `promotedToL3` 4, `maxReservesPerGroup` 7 |
| `l3` | 20 Teams, 4 Absteiger, 3 Aufsteiger in die 2. BL, vereinfachte Drittliga-Zulassung (Kapazität 5.000, Etat 1,8 Mio. €) |
| `quotas` | je Gebiet: direkte Plätze (Oberliga-Meister), Aufstiegsrunden, Kandidaten für den halben Platz |
| `halfSlotPlayoff` | Relegation Bayern/Nordost, Modus `TWO_LEGS` / `SINGLE_NEUTRAL` / `ALTERNATING_SINGLE` |
| `maxFallbackRank` | bis zu welchem Platz in derselben Oberliga nachgerückt wird (5) |
| `oberliga` | `poolSize` 10, `maxTemporaryExtra` 4 (temporäre Aufstockung), `reservoirSize` 6 |
| `allocation` | `roadFactor` 1,25; `mode` CLUSTER/COMPASS; `compassStart` N/O/S/W; Strafgewichte (Derby je Gewichtspunkt 150 km, Zweitvertretungs-Überhang, Staffelwechsel, Leistungsbalance) |
| `licensing` | ≥ 2.500 Plätze, ≥ 100 Sitzplätze, ≥ 200 lx (Ziel 400), ≥ 3 Presseplätze; Kapazität/Flutlicht Pflicht ab 2030; wirtschaftliche Stufen |
| `finance` | Garantie 40.000 € bis 2031/32, 90 % Ausschüttung, ≥ 500.000 € je Regionalverband, Vermarktungsbasis, Reisekosten, Ticketpreis, DFB-Zuschuss |
| `match` | Torbasis, Heimvorteil, Stärkeskala, Reise-Ermüdung, Derby-Bonus, Form, Dixon-Coles-ρ |
| `specialCases` | Nachrücker-Rang bei fehlender Drittliga-Lizenz, Insolvenz- und Rückzugsraten |
| `evaluation`, `prolog` | Intervall 3, Akzeptanzschwelle 40; 257 Stimmen, 2/3-Mehrheit |

Einige Parameter (Straßenfaktor, Gewichtungen, Zweitvertretungs-Grenze, Vorschlagsmodus, Schwierigkeit, Prolog) lassen sich
im Spiel unter **Einstellungen** ändern. Der Spielstand speichert seine eigene Kopie des Regelwerks.

**Fachliche Annahmen** (aus dem Antrag nicht eindeutig, deshalb konfigurierbar):
Oberliga-Kontingente: West und Südwest je 3 Meister + Aufstiegsrunde der Vizemeister um 1 Platz; Nord: Meister
Niedersachsen direkt, Meister HH/SH/HB spielen um 2 Plätze; Bayern/Nordost je 2 Meister + bester Vizemeister in die
Relegation. Die Sonderregel „mehr als 7 Zweitvertretungen“ ist als harte Obergrenze umgesetzt. Garantie und
Ausschüttung gehen an 1. Mannschaften. Das 22/5-Modell ist als 5 × 18 mit Meister-Rotation angenommen.

## Stammdaten

| Datei | Inhalt |
|---|---|
| `data/clubs.json` | 259 Vereine: Bundesliga/2. Bundesliga (Pool), 3. Liga, Regionalligen 2026/27, je 8 Oberliga-Teams der 14 Oberligen |
| `data/derbies.json` | Rivalitäten `{a, b, weight 1–3, name?, verified}` |
| `data/oberligen.json` | 14 Oberligen mit Gebiet der bisherigen Regionalliga |
| `data/geo/de.json` | Deutschland + Nachbarländer (Natural Earth 1:50m, Public Domain) |

### Schema eines Vereins

```jsonc
{
  "id": "lok",                       // stabil, eindeutig, nur Kleinbuchstaben/Ziffern
  "name": "1. FC Lokomotive Leipzig",
  "shortName": "Lok Leipzig",
  "town": "Leipzig",
  "lat": 51.309, "lon": 12.421,      // Stadionstandort
  "landesverband": "Sächsischer FV",
  "regionalverband": "NOFV",         // BFV | NOFV | NFV | WDFV | SW
  "gebiet": "NORDOST",               // WEST | SUEDWEST | NORD | BAYERN | NORDOST (Kontingent-Gebiet)
  "oberligaId": "OL-NOFV-S",         // Heim-Oberliga (Ziel bei Abstieg)
  "isReserve": false, "parentId": "…", // Zweitvertretung + Mutterverein
  "league2026": { "level": "RL", "group": "RL-NO" }, // PRO (BL/BL2) | L3 | RL (RL-BY/NO/N/W/SW) | OL (Oberliga-ID)
  "strength": 55,                    // 0–100
  "budget": 2530000,                 // € p. a.
  "fanPotential": 4500,              // erwarteter Zuschauerschnitt in der Regionalliga
  "stadium": { "name": "Bruno-Plache-Stadion", "capacity": 12321, "seats": 3270, "lux": 600, "pressSeats": 15 },
  "colors": ["#0050a0", "#fcd116"],
  "verified": true,                  // true = Liga 2026/27 und Kapazität belegt, false = bitte prüfen
  "estimated": ["strength", "budget", "…"], // Modellwerte
  "source": { "liga": "Wikipedia: RL-NO 2026/27", "stadion": "Saisonartikel RL-NO 2026/27", "abgerufen": "2026-10-31" }
}
```

### Stammdaten korrigieren

1. `data/clubs.json` bzw. `data/derbies.json` direkt bearbeiten. Ligazugehörigkeit 2026/27 und Stadionkapazität sind mit
   Wikipedia abgeglichen (Stand 31.10.2026): Bundesligen, 3. Liga und Regionalligen aus den Stadion-/Zuschauertabellen der
   Saisonartikel, Oberligen aus der Infobox des Vereinsartikels; die Quelle steht je Verein unter `source`. Sitzplätze, Lux,
   Presseplätze, Etat, Stärke und Fanpotenzial bleiben Modellwerte (`estimated`). Vereine mit `"verified": false` haben
   keine belegte Kapazität (u. a. Oberliga-Zweitvertretungen, deren Infobox nur das Stadion des Muttervereins nennt).
2. Für neue Vereine eine neue eindeutige `id` vergeben. Zweitvertretungen brauchen `isReserve: true` und `parentId`.
   Derbys verweisen auf `id`s.
3. `npm test` ausführen: Der Test „Echtwelt ist valide“ prüft eindeutige IDs, Koordinaten in Deutschland, bekannte
   Oberligen/Gebiete, plausible Stadiondaten, Mutterverein vorhanden, Derby-Referenzen und doppelte Derbys.
4. Neue Spiele verwenden die geänderten Daten. Laufende Spielstände behalten ihre eigene Kopie.

Unter Einstellungen → **Stammdaten exportieren** lässt sich der aktuelle Stand eines Spiels (inkl. Entwicklung der
Vereine und generierter Verbandsliga-Vereine) im gleichen Schema herunterladen (`format: "kompass-stammdaten"`).

## Import-/Export-Schema

- **Spielstand** (`Einstellungen → JSON exportieren/importieren`):
  `{ "format": "kompass-save", "version": 1, "exportedAt": "<ISO>", "state": GameState }`.
  Import prüft Format, Version und Regelwerk-Konsistenz. Export → Import ergibt einen identischen Spielstand (getestet).
- **Stammdaten:** `{ "format": "kompass-stammdaten", "version": 1, "clubs": Club[], "derbies": Derby[], "oberligen": Oberliga[] }`.
- **Statistik:** Ewige Tabelle je Spielklasse und Staffel, Chronik je Saison und Liga, Staffelwechsler (nur von einer
  Saison zur direkt folgenden, nach Vereinsüberschneidung), Kennzahlen des Evaluierungsberichts je Saison.
- **CSV** (`Statistik → CSV-Export`, Semikolon-getrennt, UTF-8 mit BOM): Vereinshistorie (alle Vereine × Saisons),
  Saisonkennzahlen, Ewige Tabelle, Vereine.

Spielstände im Browser liegen in IndexedDB (Schlüssel `save:*`, der automatische Spielstand unter `save:autosave` wird
bei jedem Phasenwechsel geschrieben).

## Tests

`tests/m1-data.test.ts`, `tests/engine.test.ts`, `tests/persistence.test.ts` prüfen u. a.:

- Jede Einteilung hat exakt 4 × 20 Teams, kein Team fehlt oder ist doppelt (auch mit Fixierungen und Kompass-Rotation).
- Der Optimierer ist bei gleichem Seed deterministisch und liegt bei den Gesamt-km mindestens 40 % unter Zufallseinteilungen.
- Auf-/Abstieg erhält in jeder Saison die Ligagrößen (BL, 2. BL, 3. Liga, Regionalliga, Oberliga-Pools) und die Zweitvertretungs-Regel.
- Die Kontingente der 5. Ebene werden exakt eingehalten (West 4, Südwest 4, Nord 3, Bayern + Nordost 5 inkl. Relegation).
- Zwangsabstieg einer Zweitvertretung, 22/5-Modell, fiktive Welt.
- 30 Saisons headless ohne Fehler, Tore pro Spiel 2,8–3,2, Heimsiegquote 41–49 %, plausible Punktzahlen, lückenlose Historie.
- Spielstände sind vor und nach JSON-Export/-Import identisch.

## Bekannte Grenzen

- Die Karte zeigt Länder-, aber keine Bundeslandgrenzen. Eine Bundesland-GeoJSON kann in `data/geo/` ergänzt und in `src/ui/MapView.tsx` gezeichnet werden.
- Profiligen sind abstrakt simuliert. Die Oberligen sind Pools von 10 Teams (bis 14 bei Aufstockung) statt kompletter Ligen. Ihre Etats folgen weiter dem Ligaziel, nicht den Spieleinnahmen.
- Wenn ein Verbandsliga-Reservoir leer ist, werden neue (fiktive) Vereine erzeugt. Sie sind mit `fictional: true` markiert.
