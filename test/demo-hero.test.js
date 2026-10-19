const fs = require('fs');
const path = require('path');
const { loadFrontend } = require('./helpers/frontend');

// The demo hero is the first thing a signed-out visitor sees on the hosted
// tracker. It used to name only Claude, advertise "500 achievements" long
// after there were 1,224, and promise a light theme that does not exist.
// These tests pin the hero to what the app and its demo actually contain.
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const hero = html.slice(html.indexOf('<section class="demo-hero"'), html.indexOf('</section>', html.indexOf('<section class="demo-hero"')));

describe('demo hero', () => {
  let F, G;
  beforeAll(() => {
    F = loadFrontend(['i18n.js', 'charts.js', 'demo-data.js', 'app.js']);
    G = F.pick(['LANG', 'DEMO_DATA']);
  });

  it('names all three providers the tracker reads', () => {
    for (const name of ['Claude Code', 'Codex', 'Antigravity']) expect(hero).toContain(name);
    expect(G.LANG.de.demoHeroSub).toMatch(/Claude Code.*Codex.*Antigravity/);
    expect(G.LANG.en.demoHeroSub).toMatch(/Claude Code.*Codex.*Antigravity/);
  });

  it('has every hero string in both languages', () => {
    const keys = [...hero.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(G.LANG.de[k], 'de:' + k).toBeTruthy();
      expect(G.LANG.en[k], 'en:' + k).toBeTruthy();
    }
    const demoKeys = (lang) => Object.keys(G.LANG[lang]).filter(k => k.startsWith('demo')).sort();
    expect(demoKeys('de')).toEqual(demoKeys('en'));
  });

  it('hard-codes no count that could drift from the demo', () => {
    // Counts are filled by renderDemoHero(); a literal in the markup is how
    // "500 achievements" survived for months.
    expect(hero).not.toMatch(/\b\d{3,}\s*Achievements/i);
    expect(hero).not.toMatch(/\$\d/);
    for (const lang of ['de', 'en']) {
      for (const [k, v] of Object.entries(G.LANG[lang])) {
        if (!k.startsWith('demo')) continue;
        expect(v, lang + ':' + k).not.toMatch(/\b(500|1224|1,224)\b/);
        expect(v, lang + ':' + k).not.toMatch(/Hell\/Dunkel|Light\/Dark/);
      }
    }
  });

  it('only links tour tiles to tabs that exist and are visible in the demo', () => {
    const tabs = [...hero.matchAll(/data-demo-tab="([^"]+)"/g)].map(m => m[1]);
    expect(tabs.length).toBe(12);
    for (const tab of tabs) {
      expect(html).toContain(`id="tab-${tab}"`);
      expect(tab).not.toBe('settings'); // hidden in demo mode
    }
    for (const sel of [...hero.matchAll(/data-demo-target="#([\w-]+)/g)].map(m => m[1])) {
      expect(html).toContain(`id="${sel}"`);
    }
  });

  it('fills the readouts from DEMO_DATA', () => {
    const els = {};
    F.document.getElementById = (id) => {
      if (!els[id]) {
        els[id] = { id, style: {}, textContent: '', children: [], appendChild(c) { this.children.push(c); }, append(...c) { this.children.push(...c); } };
      }
      return els[id];
    };
    F.document.createElement = () => ({ style: {}, textContent: '', children: [], appendChild(c) { this.children.push(c); }, append(...c) { this.children.push(...c); } });
    F.setLang('en');
    F.renderDemoHero();

    const D = G.DEMO_DATA;
    const ov = D.overview;
    const tokens = ov.inputTokens + ov.outputTokens + ov.cacheReadTokens + ov.cacheCreateTokens;
    expect(els['demo-v-tokens'].textContent).toBe(F.formatTokens(tokens));
    expect(els['demo-v-cost'].textContent).toBe(F.formatCost(ov.estimatedCost));
    expect(els['demo-l-tokens'].textContent).toBe(`Tokens (${D.daily.length} days)`);
    expect(els['demo-hero-foot'].textContent).not.toContain('{');

    // One bar segment per provider, shares that match the overview split.
    expect(els['demo-bar-providers'].children.length).toBe(3);
    const claudePct = Math.round(ov.providers.claude.tokens / tokens * 100);
    expect(els['demo-share-claude'].textContent).toBe(`${claudePct} % of tokens`);

    const list = D.achievements.achievements || D.achievements;
    const unlocked = list.filter(a => a.unlocked).length;
    expect(els['demo-v-ach'].textContent).toBe(`${F.formatNumber(unlocked)} / ${F.formatNumber(list.length)}`);
    expect(els['demo-tile-ach-title'].textContent).toBe(`${F.formatNumber(list.length)} achievements`);
    expect(els['demo-limit-rows'].children.length).toBe(3);
    F.setLang('de');
  });

  it('lists the Codex and Antigravity models the overview reports', () => {
    const D = G.DEMO_DATA;
    const providers = new Set(D.models.map(m => m.provider || 'claude'));
    for (const p of Object.keys(D.overview.providers)) expect(providers.has(p)).toBe(true);
  });
});
