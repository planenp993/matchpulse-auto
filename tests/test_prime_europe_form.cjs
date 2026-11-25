const test = require('node:test');
const assert = require('node:assert/strict');

const headers = 'fixture_id,date,kickoff_utc,home,away,home_id,away_id,phase,source,status,stage\n';

test('Prime shows verified supplemental league form for UEFA fixtures', async () => {
  const { europeanForecasts, euroKey } = await import('../docs/algorithm/europe.js');
  const { formView } = await import('../docs/algorithm/form-view.js');
  const day = '2026-11-25';
  const now = Date.parse(day + 'T07:35:00Z');
  const domestic = [
    ['P1', 'Portugal', 'Primeira Liga', '2026-11-08', '17:00', 'Rio Ave', 'Sporting Braga', 0, 1],
  ];
  const allDomestic = [
    ...domestic,
    ['FIN', 'Finland', 'Veikkausliiga', '2026-11-01', '15:00', 'AC Oulu', 'KuPS', 2, 0],
    ['FIN', 'Finland', 'Veikkausliiga', '2026-11-08', '15:00', 'KuPS', 'Inter Turku', 0, 2],
    ['FIN', 'Finland', 'Veikkausliiga', '2026-11-09', '15:00', 'KuPS', 'Awarded', 3, 0,
      null, null, null, null, { AWARDED: true }],
    ['FIN', 'Finland', 'Veikkausliiga', '2026-11-25', '15:00', 'KuPS', 'Same day', 1, 0],
  ];
  const records = [{
    id: 'UEFA/UEFA:1', code: 'UECL', day: '2026-11-05', home: 'KuPS Kuopio', away: 'Gent',
    teams: ['KuPS Kuopio', 'Gent'].map(euroKey), goals: [0, 0], phase: 'main',
  }];
  const csv = {
    ucl: headers,
    uel: headers,
    uecl: headers + '2,2026-11-26,2026-11-26T20:00:00Z,Sporting Braga,KuPS,100,101,main,Sportmonks,unplayed,League phase\n',
  };
  const index = { competitions: Object.keys(csv).map(slug => ({
    slug, seasons: [{ year: 2026, fixtures: Number(slug === 'uecl'), results: 0, stages: [] }],
  })) };
  const input = { records, index, csv, coverage: { seasons: [] }, fitted: { UECL: { weight: .45 } },
    now, day, observed: now };
  const [baseline] = europeanForecasts({ ...input, domestic }).matches;
  const [match] = europeanForecasts({ ...input, domestic, allDomestic }).matches;
  assert.deepEqual(match.probabilities, baseline.probabilities);
  assert.deepEqual(match.facts.domesticSample, [1, 2]);
  assert.deepEqual(match.facts.form[1].map(game => [game.opponent, game.gf, game.ga, game.competition]),
    [['AC Oulu', 0, 2, 'FIN'], ['Gent', 0, 0, 'UECL'], ['Inter Turku', 0, 2, 'FIN']]);
  assert.match(formView(match, String, {}, String), /Veikkausliiga/);
  assert.equal(euroKey('Nordsjælland'), euroKey('Nordsjaelland'));
  assert.equal(euroKey('Bodø / Glimt'), euroKey('Bodo/Glimt'));
});
