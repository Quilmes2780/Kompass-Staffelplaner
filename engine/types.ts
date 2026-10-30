// Zentrales Datenmodell. Der komplette Spielstand (GameState) ist reines JSON:
// keine Klassen, keine Maps, keine Dates – damit Export/Import verlustfrei ist.

export type ClubId = string;
export type Gebiet = "WEST" | "SUEDWEST" | "NORD" | "BAYERN" | "NORDOST";
export type Regionalverband = "BFV" | "NOFV" | "NFV" | "WDFV" | "SW";
export const GEBIETE: Gebiet[] = ["WEST", "SUEDWEST", "NORD", "BAYERN", "NORDOST"];
export const REGIONALVERBAENDE: Regionalverband[] = ["BFV", "NOFV", "NFV", "WDFV", "SW"];

export interface Stadium {
  capacity: number;
  seats: number;
  lux: number;
  pressSeats: number;
}

export interface Club {
  id: ClubId;
  name: string;
  shortName: string;
  town: string;
  lat: number;
  lon: number;
  landesverband: string;
  regionalverband: Regionalverband;
  gebiet: Gebiet;
  /** Heim-Oberliga (Ziel bei Abstieg aus der Regionalliga) */
  oberligaId: string;
  isReserve: boolean;
  parentId?: ClubId;
  /** 0–100 */
  strength: number;
  /** Jahresetat in € */
  budget: number;
  /** erwarteter Zuschauerschnitt in der Regionalliga */
  fanPotential: number;
  stadium: Stadium;
  colors: [string, string];
  verified: boolean;
  estimated?: string[];
  fictional?: boolean;
  /** Ligazugehörigkeit laut Stammdaten (Saison der Stammdaten) */
  league2026?: { level: "PRO" | "L3" | "RL" | "OL"; group: string };
}

export interface Derby {
  a: ClubId;
  b: ClubId;
  weight: 1 | 2 | 3;
  name?: string;
  verified: boolean;
}

export interface Oberliga {
  id: string;
  name: string;
  short: string;
  gebiet: Gebiet;
}

export interface WorldData {
  clubs: Club[];
  derbies: Derby[];
  oberligen: Oberliga[];
  kind: "REAL" | "FICTIONAL";
}

/** Spielklassen von oben nach unten. VL = Verbandsliga-Reservoir unter jeder Oberliga (abstrakt). */
export type Level = "BL" | "BL2" | "L3" | "RL" | "OL" | "VL";
export const LEVEL_ORDER: Level[] = ["BL", "BL2", "L3", "RL", "OL", "VL"];

export interface LeagueRef {
  level: Level;
  /** RL: Staffel-ID ("A".."D"), OL/VL: Oberliga-ID, sonst = level */
  group: string;
}

export interface Leagues {
  BL: ClubId[];
  BL2: ClubId[];
  L3: ClubId[];
  RL: Record<string, ClubId[]>;
  OL: Record<string, ClubId[]>;
  VL: Record<string, ClubId[]>;
}

// ---------- Spiele & Tabellen ----------

export interface Fixture {
  home: ClubId;
  away: ClubId;
  matchday: number;
  hg?: number;
  ag?: number;
  attendance?: number;
}

export interface TableRow {
  clubId: ClubId;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: string; // letzte Ergebnisse "WDL…" (neueste zuletzt)
}

export interface Competition {
  id: string; // "L3", "RL-A", …
  level: Level;
  group: string;
  clubs: ClubId[];
  fixtures: Fixture[];
  matchdays: number;
  played: number; // abgeschlossene Spieltage
}

export interface Tie {
  id: string;
  name: string;
  a: ClubId;
  b: ClubId;
  legs: { home: ClubId; away: ClubId; hg: number; ag: number }[];
  winner: ClubId;
  decidedBy: "AGGREGATE" | "AWAY" | "PENALTIES" | "SINGLE" | "WALKOVER";
}

export interface PromotionRoundResult {
  id: string;
  name: string;
  table: TableRow[];
  promoted: ClubId[];
}

// ---------- Staffeleinteilung ----------

export interface Allocation {
  groups: Record<string, ClubId[]>;
  fixed: ClubId[];
  label?: string;
}

export interface RuleViolation {
  rule: string; // Kurzname der verletzten Regel
  message: string;
  clubs?: ClubId[];
}

export type Ampel = "green" | "yellow" | "red";

export interface AllocationMetrics {
  totalKm: number;
  groupKm: Record<string, number>;
  avgKmPerClub: Record<string, number>;
  maxClub: { clubId: ClubId; km: number };
  giniKm: number;
  derbiesKept: number;
  derbiesSplit: number;
  derbiesKeptWeight: number;
  derbiesSplitWeight: number;
  splitDerbies: { a: ClubId; b: ClubId; weight: number }[];
  reservesPerGroup: Record<string, number>;
  groupChanges: number;
  changedClubs: ClubId[];
  avgStrength: Record<string, number>;
  strengthSpread: number;
  marketingValue: number;
  attendanceForecast: number;
  co2Tonnes: number;
  oberligaRisk: { oberligaId: string; expected: number; max: number }[];
  violations: RuleViolation[];
  ampel: Record<string, Ampel>;
}

export type HardshipReason = "DERBY" | "TRAVEL_COST" | "STADIUM_SHARING" | "PLANNING";

export interface HardshipRequest {
  id: string;
  clubId: ClubId;
  reason: HardshipReason;
  text: string;
  /** gewünschte Konstellation: gleiche Staffel wie partner bzw. Verbleib in Staffel */
  partnerId?: ClubId;
  wantsGroup?: string;
  decision?: "GRANTED" | "REJECTED";
  /** erfüllt die veröffentlichte Einteilung den Antrag? */
  fulfilled?: boolean;
}

// ---------- Zulassung ----------

export type LicenseStatus = "GRANTED" | "CONDITIONS" | "EXEMPTION" | "DENIED" | "NA";

export interface LicenseDeficit {
  code: "CAPACITY" | "SEATS" | "LUX" | "LUX_TARGET" | "PRESS" | "ECONOMIC";
  message: string;
  mandatory: boolean;
}

export interface LicenseApplication {
  clubId: ClubId;
  level: "L3" | "RL";
  deficits: LicenseDeficit[];
  decision?: LicenseStatus;
  conditions: string[];
  /** Automatisch entscheidbar, weil mängelfrei */
  clean: boolean;
}

// ---------- Stakeholder, News, Ereignisse ----------

export type StakeholderKey = "FANS" | "MEDIA" | "MARKETING" | "PRAESIDIUM" | Regionalverband;
export const STAKEHOLDERS: StakeholderKey[] = ["PRAESIDIUM", "BFV", "NOFV", "NFV", "WDFV", "SW", "FANS", "MEDIA", "MARKETING"];

export interface NewsItem {
  id: string;
  season: number;
  phase: Phase;
  headline: string;
  body?: string;
  tone: "pos" | "neg" | "neutral";
  clubs?: ClubId[];
}

export interface EventOption {
  id: string;
  label: string;
  description: string;
}

export interface GameEvent {
  id: string;
  kind: string;
  season: number;
  title: string;
  text: string;
  clubId?: ClubId;
  options: EventOption[];
  chosen?: string;
  outcome?: string;
}

export interface CourtCase {
  id: string;
  season: number;
  clubId: ClubId;
  subject: string;
  outcome?: "UPHELD" | "OVERTURNED";
}

export interface Precedent {
  season: number;
  clubId: ClubId;
  kind: "EXEMPTION" | "HARDSHIP" | "DENIAL";
  detail: string;
}

// ---------- Historie ----------

export type Movement =
  | "PROMOTED"
  | "RELEGATED"
  | "STAYED"
  | "FORCED_RELEGATION"
  | "LICENSE_DENIED"
  | "WITHDRAWN"
  | "INSOLVENT"
  | "REINSTATED";

export interface ClubSeasonRecord {
  season: number;
  clubId: ClubId;
  league: LeagueRef;
  rank: number;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  movement: Movement;
  nextLeague?: LeagueRef;
  title: boolean;
  playoff?: { name: string; won: boolean };
  travelKm: number;
  travelKmPerAway: number;
  avgAttendance: number;
  income: { guarantee: number; distribution: number; other: number };
  budgetEnd: number;
  license: { status: LicenseStatus; conditions: string[] };
  hardship: { reason: HardshipReason; granted: boolean }[];
  groupChanged: boolean;
  derbiesPlayed: number;
  /** abstrakt simulierte Ligen (BL, BL2, OL, VL) haben keine Einzelspiele */
  abstract: boolean;
}

export interface SeasonSummary {
  season: number;
  allocation?: Allocation;
  metrics?: AllocationMetrics;
  tables: Record<string, TableRow[]>; // competition-id → Abschlusstabelle
  champions: Record<string, ClubId>;
  promotedToL3: ClubId[];
  relegatedFromL3: ClubId[];
  relegatedFromRL: ClubId[];
  promotedFromOL: ClubId[];
  playoffs: Tie[];
  promotionRounds: PromotionRoundResult[];
  goalsPerGame: number;
  homeWinRate: number;
  drawRate: number;
  avgAttendanceRL: number;
  acceptance: number;
  revenue: number;
  grade?: number;
  specialCases: string[];
}

// ---------- Spielzustand ----------

export type Phase =
  | "PROLOG"
  | "LICENSING"
  | "ALLOCATION"
  | "SEASON"
  | "WRAPUP"
  | "EVENTS"
  | "EVALUATION"
  | "GAME_OVER";

export interface Settings {
  difficulty: "LEICHT" | "NORMAL" | "SCHWER";
  simSpeed: "SPIELTAG" | "WOCHE" | "SAISON";
  tutorialDone: boolean;
}

export interface Finance {
  marketingPot: number; // Zentralvermarktungserlös der laufenden Saison
  tvContractUntil: number; // Saison, bis zu der der Vertrag läuft
  dfbReserve: number;
}

export interface EvaluationReport {
  season: number;
  acceptance: number;
  trends: { key: string; label: string; value: number; delta: number }[];
  criticism: string[];
  motionFiled: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  worldKind: "REAL" | "FICTIONAL";
  rules: import("../config/rules").RulesConfig;
  settings: Settings;
  clubs: Record<ClubId, Club>;
  derbies: Derby[];
  oberligen: Oberliga[];
  season: number; // Startjahr, 2028 = 2028/29
  phase: Phase;
  leagues: Leagues;
  /** laufende Saison (nur in Phase SEASON) */
  competitions: Record<string, Competition>;
  /** veröffentlichte Einteilung der laufenden Saison */
  allocation?: Allocation;
  previousAllocation?: Allocation;
  allocationDraft?: {
    working: Allocation;
    variants: Record<string, Allocation | undefined>;
    hardship: HardshipRequest[];
    proposalSeed: number;
  };
  licensing?: { season: number; applications: LicenseApplication[] };
  pendingEvents: GameEvent[];
  satisfaction: Record<string, number>; // StakeholderKey oder ClubId
  finance: Finance;
  news: NewsItem[];
  courtCases: CourtCase[];
  precedents: Precedent[];
  history: { clubSeasons: ClubSeasonRecord[]; seasons: SeasonSummary[]; evaluations: EvaluationReport[] };
  /** Laufende Saisonwerte pro Verein (wird bei Saisonende in die Historie geschrieben) */
  seasonStats: Record<ClubId, { travelKm: number; awayGames: number; attendanceSum: number; homeGames: number; derbies: number; income: { guarantee: number; distribution: number; other: number } }>;
  licenseThisSeason: Record<ClubId, { status: LicenseStatus; conditions: string[] }>;
  hardshipThisSeason: Record<ClubId, { reason: HardshipReason; granted: boolean }[]>;
  achievements: { id: string; season: number }[];
  score: number;
  gameOver?: { season: number; reason: string };
  prolog?: { won: boolean; model: string; votes: number };
  counters: { courtFreeSeasons: number; nextId: number };
}
