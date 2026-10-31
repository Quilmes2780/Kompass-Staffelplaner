# KOMPASS – Der Staffelplaner · Projektplan

Stand: 31.10.2026 · Status: **M1–M8 umgesetzt** (Entscheidungen siehe Abschnitt 7, Dokumentation in README.md)

---

## 1. Architektur

```
/                       Vite-Projekt (React + TS strict)
├─ config/rules.ts      Alle Regelparameter (Kompassmodell als Default, 22/5 als Variante)
├─ data/
│  ├─ clubs.json        Stammdaten Echtwelt (3. Liga, RL 2026/27, Oberliga-Pool, Profi-Pool)
│  ├─ derbies.json      Rivalitäten mit Gewicht 1–3
│  ├─ oberligen.json    14 Oberligen + Gebietszuordnung (West/Südwest/Nord/Bayern/Nordost)
│  └─ geo/de-laender.json  vereinfachte Bundesland-Geometrie (TopoJSON, offline)
├─ engine/              UI-unabhängig, headless lauffähig (kein React/DOM-Import)
│  ├─ rng.ts            mulberry32, Sub-Streams pro Subsystem (forkRng("season-2029"))
│  ├─ geo.ts            Haversine, Distanzmatrix (Float32Array), Straßenfaktor
│  ├─ world/            Echtdaten-Loader, Fiktiv-Generator, Validierung
│  ├─ match.ts          Poisson-Spielmodell
│  ├─ season.ts         Spielplan (Doppelrunde, Circle-Method), Tabelle, Tiebreaker
│  ├─ promotion.ts      Auf-/Abstieg, Kontingente, Relegation, Aufstiegsrunden, Sonderfälle
│  ├─ transition.ts     Qualifikationssaison 2027/28, 90 → 80
│  ├─ allocation/       Optimierer (Clustering, Swap-Suche, Kompass-Rotation), Kennzahlen
│  ├─ licensing.ts      Zulassungsverfahren
│  ├─ economy.ts        Garantie, Zentralvermarktung, Budgets, Zuschauer
│  ├─ stakeholders.ts   Zufriedenheit, Reaktionen, Schlagzeilen
│  ├─ events.ts         Zwischensaison-Ereignisse
│  ├─ evaluation.ts     3-Jahres-Bericht, Game-over, Score, Achievements
│  ├─ history.ts        Saison-Records pro Verein, Ewige Tabelle, Rekorde
│  └─ game.ts           Phasen-Zustandsautomat (reine Funktionen: state + action → state)
├─ src/                 React-UI, Zustand-Store als dünne Hülle um engine/game.ts
│  ├─ map/              d3-geo SVG-Karte, Zoom/Pan, Drag & Drop
│  ├─ screens/          Saison | Staffeleinteilung | Zulassung | Vereine | Statistik | Verband | Einstellungen
│  └─ persistence/      IndexedDB (idb-keyval o. ä.), JSON-Export/-Import
├─ scripts/headless.ts  CLI: N Saisons simulieren, Statistik ausgeben
└─ tests/               Vitest
```

**Grundprinzipien**
- Der gesamte Spielstand ist ein serialisierbares Plain-JSON-Objekt (`GameState`). Keine Klassen, keine Maps
  im State → Export/Import ist trivial identisch (Test: `deepEqual(state, import(export(state)))`).
- Determinismus: Der RNG-Zustand liegt im State; jede Phase zieht einen eigenen, aus Seed + Saison + Subsystem
  abgeleiteten Stream. Dadurch verändert z. B. ein zusätzliches Ereignis nicht die Spielergebnisse.
- Spieler-Entscheidungen sind Actions (`{type: "moveClub", clubId, staffel}` …) und werden im State geloggt →
  Replays/Determinismustests möglich.
- Distanzmatrix wird einmal pro Welt berechnet (≈ 500 Vereine → 250k Einträge, Float32Array) und nicht gespeichert.

## 2. Datenmodell (Kern)

```ts
type ClubId = string;                    // stabil, z. B. "rwe-essen"
type Gebiet = "WEST" | "SUEDWEST" | "NORD" | "BAYERN" | "NORDOST";   // Gebiet der bisherigen RL
type Regionalverband = "WDFV" | "FRVS" | "NFV" | "BFV" | "NOFV";

interface Club {
  id: ClubId; name: string; shortName: string; town: string;
  lat: number; lon: number;
  landesverband: string; regionalverband: Regionalverband; gebiet: Gebiet;
  oberligaId: string;                    // Heim-Oberliga bei Abstieg
  isReserve: boolean; parentId?: ClubId; // Zweitvertretung + Mutterverein
  strength: number;                      // 0–100 (Basis für Angriff/Abwehr)
  budget: number;                        // € p. a.
  fanPotential: number;                  // erwarteter Zuschauerschnitt in RL
  stadium: { capacity: number; seats: number; lux: number; pressSeats: number };
  colors: [string, string];              // Primär/Sekundär für Badge (Initialen)
  verified: boolean;                     // false = Werte unsicher, bitte nachpflegen
  notes?: string;
}

interface Derby { a: ClubId; b: ClubId; weight: 1 | 2 | 3; name?: string; verified: boolean }

type LeagueLevel = "PRO" | "L3" | "RL" | "OL";
interface LeagueRef { level: LeagueLevel; groupId: string }  // z. B. {RL, "RL-B"} oder {OL, "OL-WESTFALEN"}

interface Allocation {                   // eine Staffeleinteilung (Vorschlag/Variante/veröffentlicht)
  season: string;                        // "2028/29"
  groups: Record<string, ClubId[]>;      // 4 × 20
  fixed: ClubId[];                       // vom Spieler fixiert
  hardshipDecisions: HardshipDecision[];
  metrics: AllocationMetrics;
}

interface AllocationMetrics {
  totalKm: number; avgKmPerGroup: number[]; maxClubKm: { clubId: ClubId; km: number };
  giniKm: number;
  derbiesKept: number; derbiesSplit: number;   // gewichtet
  reservesPerGroup: number[];
  groupChanges: number;                        // Wechsler ggü. Vorjahr
  strengthBalance: number;                     // Std.-Abw. der Staffelmittel
  marketingValue: number; attendanceForecast: number; co2Tonnes: number;
  oberligaRisk: { oberligaId: string; expectedRelegated: number }[];
  violations: RuleViolation[];                 // leer = veröffentlichbar
}

interface ClubSeasonRecord {             // Historie, 1 Eintrag pro Verein und Saison (lückenlos)
  season: string; clubId: ClubId; league: LeagueRef;
  rank: number; played: number; w: number; d: number; l: number; gf: number; ga: number; pts: number;
  movement: "PROMOTED" | "RELEGATED" | "STAYED" | "FORCED_RELEGATION" | "WITHDRAWN" | "REINSTATED";
  title: boolean; playoff?: { kind: string; won: boolean };
  travelKm: number; travelKmPerAway: number; avgAttendance: number;
  income: { guarantee: number; distribution: number; other: number }; budgetEnd: number;
  license: { status: "GRANTED" | "CONDITIONS" | "EXEMPTION" | "DENIED" | "N/A"; conditions: string[] };
  hardship: { reason: string; granted: boolean }[];
  groupChanged: boolean; derbiesPlayed: number;
}

interface GameState {
  version: number; seed: number; rngState: Record<string, number>;
  rules: RulesConfig;                    // Kopie, damit Saves eigene Varianten behalten
  world: { clubs: Record<ClubId, Club>; derbies: Derby[]; oberligen: Oberliga[] };
  season: string; phase: Phase;          // SIM | WRAPUP | LICENSING | ALLOCATION | EVENTS | EVALUATION | GAME_OVER
  leagues: Record<string, ClubId[]>;     // aktuelle Zugehörigkeit aller Ebenen
  currentSeason?: SeasonSim;             // Spielplan, Ergebnisse, Tabellen der laufenden Saison
  allocationDraft?: { proposal: Allocation; variants: Record<"A"|"B"|"C", Allocation> };
  satisfaction: Record<string, number>;  // clubId | Verband | "FANS" | "MEDIA" | "MARKETING" | "PRAESIDIUM"
  news: NewsItem[]; precedents: Precedent[]; courtCases: CourtCase[];
  history: { clubSeasons: ClubSeasonRecord[]; seasons: SeasonSummary[] };
  achievements: string[]; actionLog: Action[];
}
```

## 3. Simulationstiefe (Vorschlag)

| Ebene | Simulation |
|---|---|
| 1./2. Bundesliga | **abstrakt**: Pool der Profivereine mit Stärke; je Saison stärkegewichtete Zufallsrangliste → bestimmt, welche Profivereine in die 3. Liga fallen (relevant für Zweitvertretungs-Zwangsabstieg) und wer aus der 3. Liga aufsteigt |
| 3. Liga | **voll** (20 Teams, 38 Spieltage, Poisson) |
| Regionalliga | **voll**, spieltagsweise mit Zuschauern, Reise-km, Ökonomie |
| Oberligen (14) | **leicht**: Pool je Oberliga, Saisonergebnis per stärkegewichteter Rangliste + Rauschen; Aufstiegsrunden und Relegation Bayern/Nordost werden als echte Spiele simuliert |
| 6. Liga | abstrakt: Oberliga-Absteiger verschwinden in einen Reservepool, Aufsteiger werden daraus nachgezogen bzw. generiert (Ligagrößen bleiben invariant) |

## 4. Meilensteine

| # | Inhalt | Abnahme (Auszug) |
|---|---|---|
| **M1** | Vite/React/TS-Setup, ESLint, Vitest, `config/rules.ts`, PRNG, Datenmodell, `clubs.json`/`derbies.json`/`oberligen.json`, Fiktiv-Generator, Distanzmatrix, Datenvalidator, Karten-Geodaten | `npm run dev` zeigt Karte mit allen Vereinen; Validator-Test: alle IDs eindeutig, Koordinaten in DE, Derby-Referenzen gültig |
| **M2** | Spielmodell, Spielplan, Tabelle (Tiebreaker DFB), 3. Liga + RL + Oberliga-Pool, Auf-/Abstiegs-Engine mit Kontingenten, Aufstiegsrunden, Relegation BY/NO, Sonderfällen (keine Lizenz, Insolvenz, Zwangsabstieg, OL-Aufstockung) | Invarianten-Tests, Kontingent-Tests, Tor-/Heimsieg-Verteilung im Zielkorridor |
| **M3** | Qualifikationssaison 2027/28 in 5 alten Staffeln, Übergang 90 → 80 | Test: nach Übergang exakt 80 RL-Teams mit korrekter Gebietsquote |
| **M4** | Optimierer (kapazitätsbeschränktes Clustering + Swap/Relocate-Lokalsuche, Fixierungen, Derby-/Zweitvertretungs-Strafterme, Kompass-Rotation), alle Kennzahlen, Regelprüfung | 4×20-Test, Determinismus, deutlich < Zufalls-km, Benchmark < 2 s |
| **M5** | Einteilungs-UI: Karte, Drag & Drop (Karte + Listen), Fixieren & Neu-Optimieren, Varianten A/B/C mit Vergleich, Ampeln, Härtefallanträge, Veröffentlichen mit Regelprüfung | Ungültige Einteilung blockiert mit Regelname |
| **M6** | Zulassungsverfahren, Finanzen, Stakeholder, Ereignisse, Newsfeed/Schlagzeilen | – |
| **M7** | Historie, Vereinsprofil (Zeitstrahl, Kurven), Ewige Tabelle, Rekorde, Staffel-Archiv, Dashboard, CSV-Export | Lückenlose Historie-Test |
| **M8** | Evaluierung/Game over inkl. Rettungs-Minispiel, Bundestags-Prolog, Achievements, Speichern/Laden (IndexedDB), JSON-Export/-Import, Tutorial, Feinschliff, README | Save-Roundtrip-Test, 30-Saisons-Headless-Test, Abnahmekriterien |

Jeder Meilenstein endet mit grünen Tests, `tsc --noEmit` ohne Fehler und einem Commit.

## 5. Fachliche Annahmen (Defaults, sofern nicht anders geklärt)

**Spielmodell.** λ_heim = μ · exp(att_h − def_a + homeAdv + form + derby), λ_aus = μ · exp(att_a − def_h − fatigue(km)).
μ und homeAdv werden so kalibriert, dass ≈ 3,0 Tore/Spiel und ≈ 45 % Heimsiege herauskommen (Kalibrier-Test).
Leichte Dixon-Coles-Korrektur für realistischere Remisquote (~25 %).

**Tabellen-Tiebreaker:** Punkte → Tordifferenz → erzielte Tore → direkter Vergleich → Losentscheid (seeded).

**Kontingente der 5. Ebene (Vorschlag für Standard-Gebietsregeln):**

| Gebiet | Plätze | Oberligen | Default-Verteilung |
|---|---|---|---|
| West | 4 | Niederrhein, Westfalen, Mittelrhein | 3 Meister direkt + 1 Platz per Aufstiegsrunde der drei Vizemeister (Einfachrunde) |
| Südwest | 4 | Hessenliga, Baden-Württemberg, Rheinland-Pfalz/Saar | 3 Meister direkt + 1 Platz per Aufstiegsrunde der Vizemeister |
| Nord | 3 | Niedersachsen, Hamburg, Schleswig-Holstein, Bremen | Meister NI direkt; Meister HH, SH, HB spielen Aufstiegsrunde um 2 Plätze |
| Bayern | 2,5 | Bayernliga Nord, Bayernliga Süd | 2 Meister direkt; bester Vizemeister → Relegation |
| Nordost | 2,5 | NOFV-Oberliga Nord, NOFV-Oberliga Süd | 2 Meister direkt; bester Vizemeister → Relegation |

Relegation BY/NO: Hin- und Rückspiel (konfigurierbar: Einzelspiel neutral, alternierendes Heimrecht).
Verzichtet ein Berechtigter (keine Zulassung/Antrag), rückt der Nächstplatzierte derselben Oberliga nach.

**Zweitvertretungen > 7 je Staffel:** harte Nebenbedingung im Optimierer (Limit in `rules.ts`), Veröffentlichung blockiert.
**Kompass-Rotation:** Vereine nach Polarwinkel um den Schwerpunkt aller 80 Teams sortiert, beginnend beim Startwinkel
(N/O/S/W), in 4 Sektoren à 20 geschnitten, danach optional Swap-Feinschliff.
**Meister ohne Drittliga-Lizenz:** Default: Nächstplatzierter derselben Staffel mit Lizenz (bis Platz 3), sonst bleibt der Platz leer und die 3. Liga reduziert ihre Absteigerzahl.
**Bewertung:** Stakeholder 0–100, Gesamtakzeptanz = gewichtetes Mittel; Schwelle für Rückabwicklungsantrag Default 40.

**Daten.** Echtdaten nach bestem Wissen (Wissensstand bis Mitte 2026). Kader der Regionalligen 2026/27 und besonders
Stadion-Kennzahlen (Sitzplätze, Lux, Presseplätze), Budgets und Stärke sind Schätzungen → `verified: false`.
Oberliga-Pool: je Oberliga die realistischen Aufstiegskandidaten (≈ 8–10 Teams) als Echtdaten, Rest generiert.

## 6. Offene Fragen

Mit (★) markierte Punkte sind blockierend für M1–M3; alle anderen haben einen Default (siehe oben).

1. ★ **Übergang 2027/28:** Gelten die Qualifikationsplätze (BY 14, NO 14, N 15, W 16, SW 17) *zusätzlich* zu den
   2027/28-Aufsteigern in die 3. Liga? Wie viele Teams steigen nach 2027/28 aus den alten RL in die 3. Liga auf (heutige 4er-Regel)?
   Gibt es nach 2027/28 Oberliga-Aufsteiger (laut Rechnung 76 + 4 = 80: nein)?
2. ★ **Staffelgrößen 2027/28:** 5 × 18 = 90 als Annahme – oder die realen Größen 2026/27 fortschreiben?
3. ★ **Gebietsregeln der 5. Ebene:** Passt die obige Default-Verteilung (insb. Nord mit 4 Oberligen)?
4. ★ **Simulationstiefe** Oberligen/Profiligen wie in Abschnitt 3 (abstrakt) – oder Oberligen voll simulieren?
5. **Sonderregel > 7 Zweitvertretungen:** Kennt der Antrag eine konkrete Rechtsfolge (z. B. Umverteilung, Losentscheid)?
   Default: harte Obergrenze 7.
6. **22/5-Modell (Prolog-Niederlage):** Was genau bedeutet „22/5“ (5 Staffeln à wie vielen Teams, Aufstiegsmodus)?
7. **Kartendaten:** Ich würde die Bundesland-Grenzen aus Natural Earth (Public Domain, Admin-1) herunterladen,
   vereinfachen und als TopoJSON (~50–100 KB) einchecken. Einverstanden?
8. **Arbeitsweise:** Meilensteine am Stück durchziehen oder nach jedem Meilenstein für Review anhalten?
9. **Git:** Repo lokal initialisieren (Branch `main`), ein Commit pro Meilenstein, kein Remote – ok?
10. **Sprache:** UI und Code-Kommentare deutsch, Bezeichner im Code englisch – ok?

## 7. Entscheidungen (30.10.2026)

- **Übergang wird vorausgesetzt.** Das Spiel startet mit der ersten viergleisigen Saison **2028/29**
  (80 Teams). Die Startaufstellung wird aus den Stammdaten 2026/27 nach den Quali-Quoten erzeugt
  (BY 14, NO 14, N 15, W 16, SW 17 – jeweils *nach* den Drittliga-Aufsteigern – plus 4 Drittliga-Absteiger).
  Die Qualifikationssaison wird nicht gespielt. **M3** wird damit zu „Startaufstellung + erste Einteilung“.
  Erste Spielerhandlung ist die Staffeleinteilung 2028/29 (mit Tutorial).
- **Simulationstiefe abstrakt** wie in Abschnitt 3.
- **Kontingente:** Defaults aus Abschnitt 5.
- **Arbeitsweise:** M1–M8 am Stück, Stopp nur bei echten Blockern.
- Fragen 5, 6, 9, 10: Defaults. Frage 7 (Kartendaten): Ländergrenzen aus dem npm-Paket `world-atlas`
  (Natural Earth, Public Domain); Bundesländer-Grenzen optional nachrüstbar über `data/geo/`.
