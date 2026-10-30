// Zwischensaison-Ereignisse mit Entscheidungsoptionen.
import { rlClubs } from "./leagues";
import { addNews, nextId } from "./news";
import { rngFor, type Rng } from "./rng";
import { adjust } from "./stakeholders";
import type { ClubId, GameEvent, GameState } from "./types";

interface EventTemplate {
  kind: string;
  weight: (s: GameState) => number;
  make: (s: GameState, rng: Rng) => Omit<GameEvent, "id" | "season" | "kind"> | null;
  apply: (s: GameState, e: GameEvent, option: string, rng: Rng) => string;
}

const fmt = (n: number) => Math.round(n).toLocaleString("de-DE");
const pickClub = (s: GameState, rng: Rng, filter: (id: ClubId) => boolean = () => true) => {
  const list = rlClubs(s.leagues).filter(filter);
  return list.length ? rng.pick(list) : undefined;
};

const TEMPLATES: EventTemplate[] = [
  {
    kind: "TV",
    weight: (s) => (s.season >= s.finance.tvContractUntil ? 10 : 0),
    make: (s) => ({
      title: "Neuausschreibung der Medienrechte",
      text: `Der Vertrag über die Zentralvermarktung läuft aus (aktuell ${fmt(s.finance.marketingPot)} € p. a.). Drei Angebote liegen vor.`,
      options: [
        { id: "LONG", label: "Langfristig mit Free-TV-Partner", description: "4 Jahre, +5 % Erlös, hohe Reichweite. Fans und Medien zufrieden." },
        { id: "PAY", label: "Exklusiv im Pay-TV/Streaming", description: "3 Jahre, +25 % Erlös, aber Fans verärgert, Reichweite sinkt." },
        { id: "SHORT", label: "Kurzvertrag, später neu verhandeln", description: "2 Jahre, Erlös unverändert, Option auf bessere Konditionen." },
      ],
    }),
    apply: (s, _e, o) => {
      if (o === "LONG") {
        s.finance.marketingPot *= 1.05;
        s.finance.tvContractUntil = s.season + 4;
        adjust(s, "FANS", 3);
        adjust(s, "MEDIA", 4);
        adjust(s, "MARKETING", 2);
        return "Langfristiger Vertrag mit Free-TV-Partner unterschrieben.";
      }
      if (o === "PAY") {
        s.finance.marketingPot *= 1.25;
        s.finance.tvContractUntil = s.season + 3;
        adjust(s, "FANS", -7);
        adjust(s, "MARKETING", 6);
        adjust(s, "PRAESIDIUM", 3);
        return "Exklusivvertrag im Pay-TV: deutlich mehr Geld, Fanproteste angekündigt.";
      }
      s.finance.tvContractUntil = s.season + 2;
      return "Kurzvertrag abgeschlossen.";
    },
  },
  {
    kind: "SPONSOR",
    weight: () => 4,
    make: (_s, rng) => {
      const amount = Math.round((300 + rng.int(0, 900)) / 50) * 50_000;
      return {
        title: "Ligasponsor bietet Namensrechte an",
        text: `Ein Wettanbieter bietet ${fmt(amount)} € pro Jahr für den Liganamen „${rng.pick(["BetZone", "Tipp24x7", "Quotenkönig"])} Regionalliga“.`,
        options: [
          { id: "ACCEPT", label: "Annehmen", description: `+${fmt(amount)} € Vermarktungserlös, Kritik von Fans und Medien.` },
          { id: "DECLINE", label: "Ablehnen", description: "Kein Geld, aber Image bleibt sauber." },
        ],
        data: amount,
      };
    },
    apply: (s, e, o) => {
      const amount = e.data ?? 500_000;
      if (o === "ACCEPT") {
        s.finance.marketingPot += amount;
        adjust(s, "FANS", -3);
        adjust(s, "MEDIA", -2);
        adjust(s, "MARKETING", 4);
        return "Namenssponsor eingestiegen.";
      }
      adjust(s, "MEDIA", 1);
      return "Sponsorangebot abgelehnt.";
    },
  },
  {
    kind: "FAN_PROTEST",
    weight: (s) => Math.min(8, (s.allocation && s.previousAllocation ? 4 : 0) + (s.satisfaction.FANS < 50 ? 4 : 0)),
    make: (s, rng) => {
      const c = pickClub(s, rng, (id) => !s.clubs[id].isReserve);
      if (!c) return null;
      return {
        title: "Fanproteste gegen den Staffelzuschnitt",
        text: `Die Ultras von ${s.clubs[c].name} kündigen Stimmungsboykott und Spruchbänder gegen die „Reiseliga“ an.`,
        clubId: c,
        options: [
          { id: "DIALOG", label: "Fandialog anbieten", description: "Kostet 50.000 €, Fans beruhigt." },
          { id: "IGNORE", label: "Aussitzen", description: "Kein Aufwand, Medien greifen das Thema auf." },
        ],
      };
    },
    apply: (s, e, o) => {
      if (o === "DIALOG") {
        s.finance.dfbReserve -= 50_000;
        adjust(s, "FANS", 4);
        if (e.clubId) adjust(s, e.clubId, 5);
        return "Fandialog geführt, Proteste abgeflaut.";
      }
      adjust(s, "FANS", -4);
      adjust(s, "MEDIA", -3);
      return "Proteste halten an.";
    },
  },
  {
    kind: "RIOT",
    weight: () => 3,
    make: (s, rng) => {
      const d = rng.pick(s.derbies.filter((x) => rlClubs(s.leagues).includes(x.a) && rlClubs(s.leagues).includes(x.b)));
      if (!d) return null;
      return {
        title: "Ausschreitungen beim Derby",
        text: `Beim Spiel ${s.clubs[d.a].name} gegen ${s.clubs[d.b].name} kam es zu Pyrotechnik und Polizeieinsätzen. Die Innenministerkonferenz fordert Konsequenzen.`,
        clubId: d.a,
        options: [
          { id: "SEPARATE", label: "Derby künftig trennen (Empfehlung Polizei)", description: "Politik zufrieden, Fans empört." },
          { id: "FINE", label: "Geldstrafen, Derby bleibt", description: "Vereine zahlen, Medien kritisch." },
        ],
      };
    },
    apply: (s, e, o) => {
      if (o === "SEPARATE") {
        adjust(s, "FANS", -6);
        adjust(s, "PRAESIDIUM", 4);
        adjust(s, "MEDIA", 2);
        if (e.clubId) adjust(s, e.clubId, -8);
        return "Sicherheitsauflage: Derby soll in getrennten Staffeln stattfinden.";
      }
      if (e.clubId) s.clubs[e.clubId].budget = Math.max(120_000, s.clubs[e.clubId].budget - 40_000);
      adjust(s, "MEDIA", -3);
      return "Geldstrafen verhängt.";
    },
  },
  {
    kind: "STADIUM",
    weight: () => 4,
    make: (s, rng) => {
      const c = pickClub(s, rng, (id) => s.clubs[id].stadium.capacity < 5000 || s.clubs[id].stadium.lux < 400);
      if (!c) return null;
      return {
        title: "Stadionprojekt sucht Förderung",
        text: `${s.clubs[c].name} plant den Ausbau des Stadions (Kapazität ${fmt(s.clubs[c].stadium.capacity)}, Flutlicht ${s.clubs[c].stadium.lux} lx) und bittet um einen Zuschuss.`,
        clubId: c,
        options: [
          { id: "FUND", label: "Zuschuss 250.000 €", description: "Stadion erfüllt danach alle Zulassungskriterien." },
          { id: "LOAN", label: "Zinsloses Darlehen", description: "Teilausbau (Flutlicht), kein Geldverlust." },
          { id: "NO", label: "Ablehnen", description: "Verein und Regionalverband enttäuscht." },
        ],
      };
    },
    apply: (s, e, o) => {
      const c = s.clubs[e.clubId!];
      const L = s.rules.licensing;
      if (o === "FUND") {
        s.finance.dfbReserve -= 250_000;
        c.stadium.capacity = Math.max(c.stadium.capacity, L.minCapacity + 500);
        c.stadium.seats = Math.max(c.stadium.seats, 300);
        c.stadium.lux = Math.max(c.stadium.lux, L.targetLux);
        c.stadium.pressSeats = Math.max(c.stadium.pressSeats, L.minPress + 2);
        adjust(s, c.id, 12);
        adjust(s, c.regionalverband, 3);
        return `${c.name} baut aus.`;
      }
      if (o === "LOAN") {
        c.stadium.lux = Math.max(c.stadium.lux, L.minLux + 100);
        adjust(s, c.id, 4);
        return `${c.name} rüstet das Flutlicht auf.`;
      }
      adjust(s, c.id, -6);
      adjust(s, c.regionalverband, -2);
      return "Förderung abgelehnt.";
    },
  },
  {
    kind: "INVESTOR",
    weight: () => 3,
    make: (s, rng) => {
      const c = pickClub(s, rng, (id) => !s.clubs[id].isReserve);
      if (!c) return null;
      return {
        title: "Investor will einsteigen",
        text: `Ein Investor will bei ${s.clubs[c].name} einsteigen und das Budget verdoppeln. Fans befürchten den Verlust des Einflusses.`,
        clubId: c,
        options: [
          { id: "ALLOW", label: "Zulassen", description: "Verein wird deutlich stärker; Fans und Medien kritisch." },
          { id: "CONDITIONS", label: "Nur mit Auflagen (50+1-Prinzip)", description: "Halbes Investment, keine Kritik." },
        ],
      };
    },
    apply: (s, e, o) => {
      const c = s.clubs[e.clubId!];
      if (o === "ALLOW") {
        c.budget *= 2;
        c.strength = Math.min(98, c.strength + 5);
        adjust(s, "FANS", -4);
        adjust(s, "MEDIA", -2);
        adjust(s, c.id, 10);
        return `${c.name} mit Investor: Etat verdoppelt.`;
      }
      c.budget *= 1.4;
      c.strength = Math.min(98, c.strength + 2);
      return `${c.name}: Investor mit Auflagen.`;
    },
  },
  {
    kind: "CRISIS",
    weight: (s) => rlClubs(s.leagues).filter((id) => s.clubs[id].budget < 1_100_000).length,
    make: (s, rng) => {
      const c = pickClub(s, rng, (id) => s.clubs[id].budget < 1_100_000 && !s.clubs[id].isReserve);
      if (!c) return null;
      return {
        title: "Drohende Zahlungsunfähigkeit",
        text: `${s.clubs[c].name} meldet eine Liquiditätslücke von ${fmt(200_000 + rng.int(0, 300_000))} €.`,
        clubId: c,
        options: [
          { id: "HELP", label: "Überbrückungskredit (300.000 €)", description: "Verein gerettet, Präzedenzfall für andere." },
          { id: "NO", label: "Keine Hilfe", description: "Verein muss sparen, Abstiegsgefahr." },
        ],
      };
    },
    apply: (s, e, o) => {
      const c = s.clubs[e.clubId!];
      if (o === "HELP") {
        s.finance.dfbReserve -= 300_000;
        c.budget += 300_000;
        adjust(s, c.id, 12);
        adjust(s, "PRAESIDIUM", -2);
        return `${c.name} erhält Überbrückungskredit.`;
      }
      c.strength = Math.max(15, c.strength - 4);
      adjust(s, c.id, -8);
      return `${c.name} muss Spieler abgeben.`;
    },
  },
  {
    kind: "POLITICS",
    weight: () => 2,
    make: () => ({
      title: "Anfrage aus dem Bundestag",
      text: "Abgeordnete fragen nach der Klimabilanz der Regionalliga und fordern Bahnanreisen.",
      options: [
        { id: "PROMISE", label: "Reduktionsziel zusagen", description: "Politik und Medien erfreut – das Präsidium erwartet weniger km." },
        { id: "EXPLAIN", label: "Auf Optimierung verweisen", description: "Neutral." },
      ],
    }),
    apply: (s, _e, o) => {
      if (o === "PROMISE") {
        adjust(s, "MEDIA", 4);
        adjust(s, "PRAESIDIUM", 2);
        s.precedents.push({ season: s.season, clubId: "", kind: "HARDSHIP", detail: "CO2-Zusage" });
        return "Klimazusage abgegeben.";
      }
      return "Stellungnahme abgegeben.";
    },
  },
  {
    kind: "MEDIA",
    weight: (s) => (s.satisfaction.MEDIA < 55 ? 5 : 2),
    make: () => ({
      title: "Medienkampagne gegen die Reform",
      text: "Eine große Tageszeitung startet die Serie „Die Reiseliga“ mit Fahrtenbüchern von Amateurspielern.",
      options: [
        { id: "PR", label: "PR-Offensive (100.000 €)", description: "Medien und Fans etwas besänftigt." },
        { id: "NONE", label: "Nicht reagieren", description: "Akzeptanz sinkt." },
      ],
    }),
    apply: (s, _e, o) => {
      if (o === "PR") {
        s.finance.dfbReserve -= 100_000;
        adjust(s, "MEDIA", 4);
        adjust(s, "FANS", 1);
        return "PR-Offensive gestartet.";
      }
      adjust(s, "MEDIA", -4);
      return "Kampagne läuft weiter.";
    },
  },
];

/** 1–3 Ereignisse für die Zwischensaison erzeugen */
export function generateEvents(state: GameState): void {
  const rng = rngFor(state.seed, state.season, "events");
  const freq = state.settings.difficulty === "SCHWER" ? 1.4 : state.settings.difficulty === "LEICHT" ? 0.7 : 1;
  const count = Math.max(1, Math.min(4, Math.round((1 + rng.next() * 2) * freq)));
  const used = new Set<string>();
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    const cands = TEMPLATES.filter((t) => !used.has(t.kind)).map((t) => ({ t, w: t.weight(state) })).filter((x) => x.w > 0);
    const total = cands.reduce((a, x) => a + x.w, 0);
    if (!total) break;
    let r = rng.next() * total;
    const pick = cands.find((x) => (r -= x.w) <= 0) ?? cands[cands.length - 1];
    used.add(pick.t.kind);
    const body = pick.t.make(state, rng);
    if (!body) continue;
    events.push({ ...body, id: nextId(state, "ev"), kind: pick.t.kind, season: state.season });
  }
  state.pendingEvents = events;
}

export function resolveEvent(state: GameState, eventId: string, option: string): void {
  const e = state.pendingEvents.find((x) => x.id === eventId);
  if (!e || e.chosen) return;
  const t = TEMPLATES.find((x) => x.kind === e.kind)!;
  if (!e.options.some((o) => o.id === option)) throw new Error("Unbekannte Option");
  e.chosen = option;
  e.outcome = t.apply(state, e, option, rngFor(state.seed, state.season, "event-apply", e.id));
  addNews(state, `${e.title}: ${e.outcome}`, "neutral", e.clubId ? [e.clubId] : undefined);
}

/** Für Headless-Läufe: jeweils die erste Option wählen */
export function autoResolveEvents(state: GameState): void {
  for (const e of state.pendingEvents) if (!e.chosen) resolveEvent(state, e.id, e.options[0].id);
}
