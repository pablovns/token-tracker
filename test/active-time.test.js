const fs = require('fs');
const os = require('os');
const path = require('path');
const Aggregator = require('../lib/aggregator');
const db = require('../lib/db');
const { buildStats } = require('../lib/achievements');

const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute).toISOString();
const msg = (id, sessionId, timestamp, extras = {}) => ({
  id, sessionId, timestamp, project: 'time-test', model: 'claude-sonnet-4-5',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0,
  tools: [], ...extras
});

function fromDisposableDB(messages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-time-test-'));
  db.initDB(path.join(dir, 'tracker.db'));
  try {
    db.insertMessages(messages);
    const agg = new Aggregator();
    agg.addMessages(db.streamAllMessages());
    return agg;
  } finally {
    db.closeDB();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('active time from disposable SQLite databases', () => {
  it('does not invent work time for a single timestamp', () => {
    const agg = fromDisposableDB([msg('only', 'one', at(8, 10, 0))]);
    expect(agg.getOverview().totalActiveMin).toBe(0);
    expect(agg.getOverview().spanMin).toBe(0);
    expect(Object.values(agg.getActiveMinutesByDate()).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('counts parallel sessions once while retaining each session time', () => {
    const agg = fromDisposableDB([
      msg('a1', 'a', at(8, 10, 0)), msg('a2', 'a', at(8, 10, 4)),
      msg('b1', 'b', at(8, 10, 0)), msg('b2', 'b', at(8, 10, 4))
    ]);
    expect(agg.getOverview().totalActiveMin).toBe(4);
    expect(agg.getActiveMinutesByDate()['2026-10-08']).toBe(4);
    expect(buildStats(agg).totalActiveHours).toBeCloseTo(4 / 60);
    expect(agg.getSessions().map(s => s.activeMin)).toEqual([4, 4]);
  });

  it('splits a cross-midnight session and reconciles days with the total', () => {
    const agg = fromDisposableDB([
      msg('a1', 'a', at(8, 23, 58)), msg('a2', 'a', at(9, 0, 2))
    ]);
    const days = agg.getActiveMinutesByDate();
    expect(days).toMatchObject({ '2026-10-08': 2, '2026-10-09': 2 });
    expect(Object.values(days).reduce((a, b) => a + b, 0)).toBe(agg.getOverview().totalActiveMin);
    expect(buildStats(agg).maxDayActiveMin).toBe(2);
    const capped = fromDisposableDB([
      msg('b1', 'b', at(8, 23, 58)), msg('b2', 'b', at(9, 0, 10))
    ]);
    expect(capped.getActiveMinutesByDate()['2026-10-09']).toBe(5);
    expect(capped.getOverview().totalActiveMin).toBe(5);
  });

  it('shares the timeline across providers and sub-agents in overview, project, and trends', () => {
    const messages = [
      msg('c1', 'claude', at(8, 10, 0)), msg('c2', 'claude', at(8, 10, 4)),
      msg('x1', 'codex', at(8, 10, 1), { provider: 'codex' }),
      msg('x2', 'codex', at(8, 10, 3), { provider: 'codex' }),
      msg('s1', 'sub', at(8, 10, 2), { isSubagent: true }),
      msg('s2', 'sub', at(8, 10, 4), { isSubagent: true })
    ];
    const agg = fromDisposableDB(messages);
    expect(agg.getOverview().totalActiveMin).toBe(4);
    expect(agg.getOverview().spanMin).toBe(4);
    expect(agg.getProjectDetail('time-test').totalActiveMin).toBe(4);
    expect(agg.getProjectDetail('time-test').spanMin).toBe(4);
    const trends = agg.getTrends(new Date(2026, 9, 8, 11, 0));
    expect(trends.today.current.activeMin).toBe(4);
    expect(trends.today.current.spanMin).toBe(4);
    expect(buildStats(agg).totalActiveHours).toBeCloseTo(4 / 60);
  });

  it('never exceeds a day and counts hours with messages beyond session starts', () => {
    const messages = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 4) messages.push(msg(`m-${h}-${m}`, 'one', at(8, h, m)));
    }
    const agg = fromDisposableDB(messages);
    const stats = buildStats(agg);
    expect(stats.maxDayActiveMin).toBeLessThanOrEqual(1440);
    expect(stats.maxHoursInDay).toBe(24);
    expect(stats.daysWith8Hours).toBe(1);
    expect(Object.values(agg.getActiveMinutesByDate()).reduce((a, b) => a + b, 0))
      .toBe(agg.getOverview().totalActiveMin);
  });
});
