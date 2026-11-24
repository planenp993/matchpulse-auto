import { markets, scoreGrid } from '../docs/algorithm/core.js';

const LIMIT = 30;
export const DOMESTIC_MODEL = 'Prime 80/20';

function poisson(rate) {
  if (!Number.isFinite(rate) || rate < .12 || rate > 6) throw new Error('Невалидна оценка за положенията');
  const p = [Math.exp(-rate)];
  for (let goals = 1; goals <= LIMIT; goals++) p.push(p[goals - 1] * rate / goals);
  return p;
}

function originalGrid(match, scoring, fitted) {
  if (match.model === 'similar_defence') {
    const { first, positiveGoalRates } = match.facts;
    if (!first || !positiveGoalRates) return null;
    return scoreGrid(first, positiveGoalRates, scoring.parameters.dependence);
  }
  if (match.model === 'results' && match.facts.goals && fitted[match.league]?.preset) {
    const model = globalThis.MatchpulseModel;
    const rho = model.params[fitted[match.league].preset].rho;
    return model.distribution(...match.facts.goals, rho).matrix;
  }
  return null;
}

export function mixDistribution(original, rates, weight) {
  const [home, away] = rates.map(poisson);
  return home.map((p, h) => away.map((q, a) => (1 - weight) * (original[h]?.[a] ?? 0) + weight * p * q));
}

export function applyForecastRelease(snapshot, { release, scoring, fitted }) {
  const supported = new Set(release.domestic);
  const weight = release.domesticChanceWeight;
  if (!(Number.isFinite(weight) && weight > 0 && weight < 1) || !release.version)
    throw new Error('Невалидна версия на Prime Algorithm');
  const matches = snapshot.matches.map(({ chanceRates, ...match }) => {
    if (match.forecastEdition || !chanceRates || !supported.has(match.league)) return match;
    const original = originalGrid(match, scoring, fitted);
    if (!original) return match;
    const { probabilities, scoring: teamScoring, expectedGoals, scorelines } = match;
    const baseline = { probabilities, scoring: teamScoring, expectedGoals, scorelines };
    const blended = markets(mixDistribution(original, chanceRates, weight));
    return { ...match, ...blended, selectionForecast: baseline, forecastEdition: DOMESTIC_MODEL };
  });
  return { ...snapshot, matches, forecastRelease: release.version };
}
