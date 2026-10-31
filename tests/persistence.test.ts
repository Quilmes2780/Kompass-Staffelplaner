import { describe, expect, it } from "vitest";
import { autoAdvance, newGame } from "../engine/game";
import { clubSeasonsCSV, exportMasterData, exportState, importMasterData, importState, seasonsCSV } from "../engine/persistence";
import { eternalTable, records, rivalryRecord } from "../engine/stats";

describe("Speichern / Laden", () => {
  it("Spielstand ist nach JSON-Export/-Import identisch", () => {
    let s = newGame({ seed: 17 });
    for (let i = 0; i < 2; i++) s = autoAdvance(s);
    const json = exportState(s, "2026-10-30T00:00:00.000Z");
    const back = importState(json);
    expect(back).toEqual(s);
    expect(exportState(back, "2026-10-30T00:00:00.000Z")).toBe(json);
    // nach dem Import weiterspielen ergibt dasselbe wie ohne Umweg
    expect(autoAdvance(back)).toEqual(autoAdvance(s));
  });
  it("lehnt fremde Dateien ab", () => {
    expect(() => importState("{}")).toThrow(/KOMPASS/);
    expect(() => importState("kein json")).toThrow(/JSON/);
  });
  it("Stammdaten-Export ist wieder importierbar", () => {
    const s = newGame({ seed: 1 });
    const f = importMasterData(exportMasterData(s));
    expect(f.clubs.length).toBe(Object.keys(s.clubs).length);
  });
});

describe("Statistik", () => {
  it("Ewige Tabelle, Rekorde und CSV", () => {
    let s = newGame({ seed: 23 });
    for (let i = 0; i < 3; i++) s = autoAdvance(s);
    const et = eternalTable(s);
    expect(et.length).toBeGreaterThan(80);
    expect(et[0].pts).toBeGreaterThanOrEqual(et[1].pts);
    expect(records(s).length).toBeGreaterThan(5);
    expect(rivalryRecord(s, "lok").length).toBeGreaterThan(0);
    const csv = clubSeasonsCSV(s);
    expect(csv.split("\n").length).toBe(s.history.clubSeasons.length + 1);
    expect(seasonsCSV(s).split("\n")).toHaveLength(4);
  });
});
