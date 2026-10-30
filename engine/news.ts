import type { ClubId, GameState, NewsItem } from "./types";

export function nextId(state: GameState, prefix: string): string {
  return `${prefix}-${state.counters.nextId++}`;
}

export function addNews(state: GameState, headline: string, tone: NewsItem["tone"], clubs?: ClubId[], body?: string): void {
  state.news.push({ id: nextId(state, "n"), season: state.season, phase: state.phase, headline, tone, clubs, body });
  // Newsfeed begrenzen (Historie liegt in den Saison-Zusammenfassungen)
  if (state.news.length > 400) state.news.splice(0, state.news.length - 400);
}
