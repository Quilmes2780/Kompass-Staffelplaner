// Alle Regelparameter an einer Stelle. Der Spielstand speichert eine Kopie,
// sodass Varianten (Einstellungen, 22/5-Modell) pro Spielstand unabhängig sind.
import type { Gebiet } from "../engine/types";

/** Platzierung in einer Oberliga, z. B. Meister der Oberliga Westfalen = { oberligaId: "OL-WF", rank: 1 } */
export interface Entrant {
  oberligaId: string;
  rank: number;
}

export interface PromotionRound {
  id: string;
  name: string;
  entrants: Entrant[];
  slots: number;
  /** "single": Einfachrunde (jeder gegen jeden, neutrale Heimrechtverteilung), "double": Hin- und Rückrunde */
  format: "single" | "double";
}

export interface GebietQuota {
  /** Ganzzahlige Aufstiegsplätze des Gebiets (ohne halben Platz) */
  slots: number;
  direct: Entrant[];
  rounds: PromotionRound[];
  /** Kandidaten für die Relegation um den halben Platz; der beste (Punkte pro Spiel) nimmt teil */
  halfSlotCandidates?: Entrant[];
}

export type TieMode = "TWO_LEGS" | "SINGLE_NEUTRAL" | "ALTERNATING_SINGLE";

export interface RulesConfig {
  id: string;
  name: string;
  description: string;
  startSeason: number;
  rl: {
    groupIds: string[];
    groupSize: number;
    relegatedPerGroup: number;
    /** Aufsteiger in die 3. Liga; bei mehr Staffeln als Plätzen spielen überzählige Meister eine Relegation */
    promotedToL3: number;
    maxReservesPerGroup: number;
    championPlayoffMode: TieMode;
  };
  l3: {
    size: number;
    relegated: number;
    promotedToBL2: number;
    /** vereinfachte Drittliga-Zulassung für Aufsteiger */
    licenseMinCapacity: number;
    licenseMinBudget: number;
  };
  pro: { blSize: number; bl2Size: number; exchange: number };
  quotas: Record<Gebiet, GebietQuota>;
  halfSlotPlayoff: { gebiete: [Gebiet, Gebiet]; mode: TieMode } | null;
  /** Bis zu welcher Platzierung in derselben Oberliga nachgerückt wird, wenn ein Berechtigter ausfällt */
  maxFallbackRank: number;
  /** Startaufstellung: Quali-Plätze je Gebiet + Absteiger aus der 3. Liga */
  startQuotas: Record<Gebiet, number>;
  startFromL3: number;
  oberliga: {
    /** Anzahl abgebildeter Teams je Oberliga (Spitzengruppe, abstrakt) */
    poolSize: number;
    /** temporäre Aufstockung, wenn zu viele Absteiger in dieselbe Oberliga fallen */
    maxTemporaryExtra: number;
    /** Teams im Verbandsliga-Reservoir je Oberliga */
    reservoirSize: number;
  };
  allocation: {
    roadFactor: number;
    mode: "CLUSTER" | "COMPASS";
    compassStart: "N" | "O" | "S" | "W";
    /** Strafgewichte in km-Äquivalenten */
    weights: {
      derbySplitPerWeight: number;
      reserveOverLimit: number;
      groupChange: number;
      strengthImbalance: number;
    };
    localSearchPasses: number;
    restarts: number;
  };
  licensing: {
    minCapacity: number;
    minSeats: number;
    minLux: number;
    targetLux: number;
    minPress: number;
    /** ab dieser Saison sind Kapazität und Flutlicht Pflicht (Übergangsfrist) */
    infrastructureMandatoryFrom: number;
    /** Stufen des wirtschaftlichen Zulassungsverfahrens: ab Saison → Mindest-Etat in € */
    economicStages: { from: number; minBudget: number; label: string }[];
  };
  finance: {
    guaranteePerClub: number;
    /** Garantie gilt für alle Saisons mit Startjahr ≤ diesem Wert (mindestens bis 2032) */
    guaranteeUntilSeason: number;
    distributionShare: number;
    minPerRegionalverband: number;
    marketingBase: number;
    travelCostPerKm: number;
    ticketPrice: number;
  };
  match: {
    baseGoals: number;
    homeAdvantage: number;
    strengthScale: number;
    fatiguePer100Km: number;
    derbyBonus: number;
    formWeight: number;
    rho: number;
  };
  specialCases: {
    noLicenseChampionMaxRank: number;
    insolvencyBaseRate: number;
    withdrawalBaseRate: number;
  };
  evaluation: {
    intervalSeasons: number;
    acceptanceThreshold: number;
  };
  prolog: {
    enabled: boolean;
    votesTotal: number;
    requiredShare: number;
  };
}

/** Kompassmodell laut DFB-Antrag vom 30.10.2026 */
export const KOMPASS_RULES: RulesConfig = {
  id: "KOMPASS",
  name: "Kompassmodell",
  description: "4 Staffeln à 20, 4 direkte Aufsteiger, 16 Absteiger, Kontingente West 4 / Südwest 4 / Nord 3 / Bayern 2,5 / Nordost 2,5.",
  startSeason: 2028,
  rl: {
    groupIds: ["A", "B", "C", "D"],
    groupSize: 20,
    relegatedPerGroup: 4,
    promotedToL3: 4,
    maxReservesPerGroup: 7,
    championPlayoffMode: "TWO_LEGS",
  },
  l3: { size: 20, relegated: 4, promotedToBL2: 3, licenseMinCapacity: 5000, licenseMinBudget: 1_800_000 },
  pro: { blSize: 18, bl2Size: 18, exchange: 3 },
  quotas: {
    WEST: {
      slots: 4,
      direct: [{ oberligaId: "OL-NR", rank: 1 }, { oberligaId: "OL-WF", rank: 1 }, { oberligaId: "OL-MR", rank: 1 }],
      rounds: [{
        id: "AR-WEST", name: "Aufstiegsrunde West", slots: 1, format: "single",
        entrants: [{ oberligaId: "OL-NR", rank: 2 }, { oberligaId: "OL-WF", rank: 2 }, { oberligaId: "OL-MR", rank: 2 }],
      }],
    },
    SUEDWEST: {
      slots: 4,
      direct: [{ oberligaId: "OL-HE", rank: 1 }, { oberligaId: "OL-BW", rank: 1 }, { oberligaId: "OL-RPS", rank: 1 }],
      rounds: [{
        id: "AR-SW", name: "Aufstiegsrunde Südwest", slots: 1, format: "single",
        entrants: [{ oberligaId: "OL-HE", rank: 2 }, { oberligaId: "OL-BW", rank: 2 }, { oberligaId: "OL-RPS", rank: 2 }],
      }],
    },
    NORD: {
      slots: 3,
      direct: [{ oberligaId: "OL-NI", rank: 1 }],
      rounds: [{
        id: "AR-NORD", name: "Aufstiegsrunde Nord", slots: 2, format: "single",
        entrants: [{ oberligaId: "OL-HH", rank: 1 }, { oberligaId: "OL-SH", rank: 1 }, { oberligaId: "OL-HB", rank: 1 }],
      }],
    },
    BAYERN: {
      slots: 2,
      direct: [{ oberligaId: "OL-BYN", rank: 1 }, { oberligaId: "OL-BYS", rank: 1 }],
      rounds: [],
      halfSlotCandidates: [{ oberligaId: "OL-BYN", rank: 2 }, { oberligaId: "OL-BYS", rank: 2 }],
    },
    NORDOST: {
      slots: 2,
      direct: [{ oberligaId: "OL-NOFV-N", rank: 1 }, { oberligaId: "OL-NOFV-S", rank: 1 }],
      rounds: [],
      halfSlotCandidates: [{ oberligaId: "OL-NOFV-N", rank: 2 }, { oberligaId: "OL-NOFV-S", rank: 2 }],
    },
  },
  halfSlotPlayoff: { gebiete: ["BAYERN", "NORDOST"], mode: "TWO_LEGS" },
  maxFallbackRank: 5,
  startQuotas: { BAYERN: 14, NORDOST: 14, NORD: 15, WEST: 16, SUEDWEST: 17 },
  startFromL3: 4,
  oberliga: { poolSize: 10, maxTemporaryExtra: 4, reservoirSize: 6 },
  allocation: {
    roadFactor: 1.25,
    mode: "CLUSTER",
    compassStart: "N",
    weights: {
      derbySplitPerWeight: 150,
      reserveOverLimit: 5000,
      groupChange: 0,
      strengthImbalance: 0,
    },
    localSearchPasses: 40,
    restarts: 6,
  },
  licensing: {
    minCapacity: 2500,
    minSeats: 100,
    minLux: 200,
    targetLux: 400,
    minPress: 3,
    infrastructureMandatoryFrom: 2030,
    economicStages: [
      { from: 2028, minBudget: 0, label: "Stufe 0: Selbstauskunft" },
      { from: 2029, minBudget: 900_000, label: "Stufe 1: Liquiditätsnachweis" },
      { from: 2031, minBudget: 1_300_000, label: "Stufe 2: Planbilanz und Mindestetat" },
    ],
  },
  finance: {
    guaranteePerClub: 40_000,
    guaranteeUntilSeason: 2031,
    distributionShare: 0.9,
    minPerRegionalverband: 500_000,
    marketingBase: 9_000_000,
    travelCostPerKm: 4,
    ticketPrice: 11,
  },
  match: {
    baseGoals: 1.33,
    homeAdvantage: 0.17,
    strengthScale: 0.028,
    fatiguePer100Km: 0.012,
    derbyBonus: 0.05,
    formWeight: 0.03,
    rho: -0.08,
  },
  specialCases: {
    noLicenseChampionMaxRank: 3,
    insolvencyBaseRate: 0.006,
    withdrawalBaseRate: 0.003,
  },
  evaluation: { intervalSeasons: 3, acceptanceThreshold: 40 },
  prolog: { enabled: false, votesTotal: 257, requiredShare: 2 / 3 },
};

/**
 * Alternativszenario bei verlorenem Bundestag: 5 Staffeln (Parameter frei anpassbar).
 * Annahme: 5 × 18 Teams, 3 Absteiger je Staffel, 4 Aufsteiger (3 Meister direkt nach Rotation, 2 Meister in Relegation).
 */
export const MODEL_22_5_RULES: RulesConfig = {
  ...KOMPASS_RULES,
  id: "MODEL_22_5",
  name: "22/5-Modell",
  description: "5 Staffeln à 18, 4 Aufsteiger (Meister-Rotation + Relegation), 15 Absteiger, 3 Aufsteiger je Gebiet.",
  rl: { ...KOMPASS_RULES.rl, groupIds: ["A", "B", "C", "D", "E"], groupSize: 18, relegatedPerGroup: 3, maxReservesPerGroup: 6 },
  quotas: {
    WEST: { slots: 3, direct: [{ oberligaId: "OL-NR", rank: 1 }, { oberligaId: "OL-WF", rank: 1 }, { oberligaId: "OL-MR", rank: 1 }], rounds: [] },
    SUEDWEST: { slots: 3, direct: [{ oberligaId: "OL-HE", rank: 1 }, { oberligaId: "OL-BW", rank: 1 }, { oberligaId: "OL-RPS", rank: 1 }], rounds: [] },
    NORD: KOMPASS_RULES.quotas.NORD,
    BAYERN: {
      slots: 3, direct: [{ oberligaId: "OL-BYN", rank: 1 }, { oberligaId: "OL-BYS", rank: 1 }], rounds: [{
        id: "AR-BY", name: "Aufstiegsspiel Bayern", slots: 1, format: "double",
        entrants: [{ oberligaId: "OL-BYN", rank: 2 }, { oberligaId: "OL-BYS", rank: 2 }],
      }],
    },
    NORDOST: {
      slots: 3, direct: [{ oberligaId: "OL-NOFV-N", rank: 1 }, { oberligaId: "OL-NOFV-S", rank: 1 }], rounds: [{
        id: "AR-NO", name: "Aufstiegsspiel Nordost", slots: 1, format: "double",
        entrants: [{ oberligaId: "OL-NOFV-N", rank: 2 }, { oberligaId: "OL-NOFV-S", rank: 2 }],
      }],
    },
  },
  halfSlotPlayoff: null,
  startQuotas: { BAYERN: 18, NORDOST: 18, NORD: 18, WEST: 18, SUEDWEST: 18 },
  startFromL3: 0,
};

export const RULE_PRESETS: Record<string, RulesConfig> = {
  KOMPASS: KOMPASS_RULES,
  MODEL_22_5: MODEL_22_5_RULES,
};

export function cloneRules(r: RulesConfig): RulesConfig {
  return JSON.parse(JSON.stringify(r));
}

/** Anzahl RL-Teams laut Regelwerk */
export function rlSize(r: RulesConfig): number {
  return r.rl.groupIds.length * r.rl.groupSize;
}

/** Summe der Aufstiegsplätze aus der 5. Ebene (inkl. halbem Platz) */
export function totalQuota(r: RulesConfig): number {
  let s = 0;
  for (const q of Object.values(r.quotas)) s += q.slots;
  return s + (r.halfSlotPlayoff ? 1 : 0);
}

/** Konsistenzprüfung des Regelwerks – liefert Fehlermeldungen */
export function validateRules(r: RulesConfig): string[] {
  const errs: string[] = [];
  const down = r.rl.groupIds.length * r.rl.relegatedPerGroup;
  if (totalQuota(r) !== down) errs.push(`Kontingente (${totalQuota(r)}) ≠ RL-Absteiger (${down})`);
  for (const [g, q] of Object.entries(r.quotas)) {
    const n = q.direct.length + q.rounds.reduce((a, x) => a + x.slots, 0);
    if (n !== q.slots) errs.push(`Gebiet ${g}: ${n} Plätze definiert, ${q.slots} erwartet`);
  }
  if (r.l3.relegated !== r.rl.promotedToL3) errs.push("3.-Liga-Absteiger ≠ RL-Aufsteiger");
  if (r.rl.promotedToL3 > r.rl.groupIds.length) errs.push("Mehr Aufsteiger als Staffeln");
  const startSum = Object.values(r.startQuotas).reduce((a, b) => a + b, 0) + r.startFromL3;
  if (startSum !== rlSize(r)) errs.push(`Startaufstellung ${startSum} ≠ ${rlSize(r)}`);
  return errs;
}

/** Saisonbezeichnung 2028 → "2028/29" */
export function seasonLabel(y: number): string {
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
}
