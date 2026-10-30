import { describe, expect, it } from "vitest";
import { createRng, rngFor } from "../engine/rng";
import { DistanceMatrix, haversineKm } from "../engine/geo";
import { generateFictionalWorld, loadRealWorld, validateWorld } from "../engine/world";
import { KOMPASS_RULES, MODEL_22_5_RULES, validateRules } from "../config/rules";

describe("PRNG", () => {
  it("ist deterministisch und gleichverteilt", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
  it("leitet unabhängige Streams ab", () => {
    expect(rngFor(1, 2029, "match", 3).next()).toBe(rngFor(1, 2029, "match", 3).next());
    expect(rngFor(1, 2029, "match", 3).next()).not.toBe(rngFor(1, 2029, "match", 4).next());
  });
  it("Poisson hat den richtigen Mittelwert", () => {
    const r = createRng(7);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.poisson(1.5);
    expect(s / 20000).toBeCloseTo(1.5, 1);
  });
});

describe("Regelwerk", () => {
  it("Kompassmodell und 22/5 sind konsistent", () => {
    expect(validateRules(KOMPASS_RULES)).toEqual([]);
    expect(validateRules(MODEL_22_5_RULES)).toEqual([]);
  });
});

describe("Stammdaten", () => {
  it("Echtwelt ist valide", () => {
    expect(validateWorld(loadRealWorld())).toEqual([]);
  });
  it("Fiktive Welt ist valide und deterministisch", () => {
    const w = generateFictionalWorld(5);
    expect(validateWorld(w)).toEqual([]);
    expect(generateFictionalWorld(5)).toEqual(w);
    expect(w.clubs.length).toBe(loadRealWorld().clubs.length);
  });
});

describe("Distanzen", () => {
  it("Haversine Berlin–München ≈ 504 km", () => {
    expect(haversineKm(52.52, 13.405, 48.137, 11.575)).toBeGreaterThan(495);
    expect(haversineKm(52.52, 13.405, 48.137, 11.575)).toBeLessThan(510);
  });
  it("Matrix ist symmetrisch und nutzt den Straßenfaktor", () => {
    const w = loadRealWorld();
    const m = new DistanceMatrix(w.clubs, 1.25);
    expect(m.get("lok", "bsg")).toBe(m.get("bsg", "lok"));
    expect(m.get("lok", "lok")).toBe(0);
    const c1 = w.clubs.find((c) => c.id === "fcb2")!;
    const c2 = w.clubs.find((c) => c.id === "bvb2")!;
    expect(m.get("fcb2", "bvb2")).toBeCloseTo(haversineKm(c1.lat, c1.lon, c2.lat, c2.lon) * 1.25, 0);
  });
});
