#!/usr/bin/env node
// scripts/snapshot.js
// Fetches live stats for all players and writes data/stats.json
// Run by GitHub Actions every 2 hours — no CORS, API keys safe

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── Helpers ───────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'israeli-athletes-tracker/1.0' } }, r => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => {
        try { res(JSON.parse(body)); }
        catch(e) { res(null); }
      });
    }).on('error', () => res(null));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Player list (subset with known API IDs) ────────────────────────────────

const PLAYERS = [
  // NBA - ESPN API
  { id: 'avdija',    sport: 'nba',    espnId: '4683021' },
  { id: 'saraf',     sport: 'nba',    espnId: '5242502' },
  { id: 'wolf',      sport: 'nba',    espnId: '5107173' },
  // NHL - NHL.com API
  { id: 'zbuium',    sport: 'nhl',    nhlId: 8484798 },
  { id: 'romanov',   sport: 'nhl',    espnId: '4697940' },
  // Soccer - ESPN API
  { id: 'gloukh',    sport: 'soccer', espnId: '5048073', lk: 'ned.1' },
  { id: 'solomon',   sport: 'soccer', espnId: '272985',  lk: 'ita.1' },
  { id: 'dperetz',   sport: 'soccer', espnId: '305926',  lk: 'eng.2' },
  { id: 'khalili',   sport: 'soccer', espnId: '5049812', lk: 'bel.1' },
  { id: 'dasa',      sport: 'soccer', espnId: '330553',  lk: 'ned.1' },
  { id: 'weissman',  sport: 'soccer', espnId: '358942',  lk: 'aut.1' },
  { id: 'baltaxa',   sport: 'soccer', espnId: '368892',  lk: 'aut.1' },
  { id: 'altman',    sport: 'soccer', espnId: '243898',  lk: 'gre.1' },
  { id: 'glazer',    sport: 'soccer', espnId: '252814',  lk: 'ger.2' },
  { id: 'lemkin',    sport: 'soccer', espnId: '313070',  lk: 'bel.1' },
  { id: 'nachmias',  sport: 'soccer', espnId: '313169',  lk: 'bel.1' },
  { id: 'ddavid',    sport: 'soccer', espnId: '3945812', lk: 'jpn.1' },
  { id: 'abada',     sport: 'soccer', espnId: '312976',  lk: 'usa.1' },
  { id: 'turgeman',  sport: 'soccer', espnId: '4886065', lk: 'usa.1' },
  { id: 'feingold',  sport: 'soccer', espnId: '4727482', lk: 'usa.1' },
  { id: 'toklomati', sport: 'soccer', espnId: '4742301', lk: 'usa.1' },
  { id: 'nlavi',     sport: 'soccer', espnId: '3941093', lk: 'usa.1' },
  { id: 'eshamir',   sport: 'soccer', espnId: '3940991', lk: 'usa.1' },
];

// ─── Fetchers ──────────────────────────────────────────────────────────────

async function fetchNBA(p) {
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${p.espnId}/overview`;
  const d = await get(url);
  if (!d) return null;
  const cats = d?.athlete?.statistics?.splits?.categories
             || d?.athlete?.statistics?.categories || [];
  const t = {};
  for (const cat of cats) {
    for (const s of (cat.stats || [])) {
      const nm = (s.name||'').toLowerCase().replace(/[^a-z]/g,'');
      const v  = parseFloat(s.value);
      if (isNaN(v)) continue;
      const M = { avgpoints:'pts', avgrebounds:'reb', avgassists:'ast',
                  avgsteals:'stl', avgblocks:'blk', avgturnover:'tov',
                  avgminutes:'min', gamesplayed:'gp', gamesstarted:'gs' };
      if (M[nm]) t[M[nm]] = v;
      if (nm === 'fieldgoalpercentage')       t.fgp = +(v*100).toFixed(1);
      if (nm === 'threepointfieldgoalpercentage') t.tpp = +(v*100).toFixed(1);
      if (nm === 'freethrowpercentage')        t.ftp = +(v*100).toFixed(1);
    }
  }
  return Object.keys(t).length > 3 ? t : null;
}

async function fetchNHL_nhle(p) {
  const url = `https://api-web.nhle.com/v1/player/${p.nhlId}/landing`;
  const d = await get(url);
  if (!d) return null;
  const ss = (d.seasonTotals||[]).find(s => s.seasonId===20252026 && s.gameTypeId===2 && s.leagueAbbrev==='NHL')
           || (d.seasonTotals||[]).filter(s=>s.leagueAbbrev==='NHL'&&s.gameTypeId===2).pop();
  if (!ss) return null;
  return {
    goals: ss.goals||0, assists: ss.assists||0, points: ss.points||0,
    plusMinus: ss.plusMinus||0, pim: ss.pim||0, shots: ss.shots||0,
    hits: ss.hits||0, blocks: ss.blockedShots||0, gp: ss.gamesPlayed||0,
    toi: ss.avgToi||''
  };
}

async function fetchESPNHockey(p) {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl/athletes/${p.espnId}/statistics`;
  const d = await get(url);
  if (!d) return null;
  const cats = d?.splits?.categories || [];
  const t = {};
  for (const cat of cats) {
    for (const s of (cat.stats||[])) {
      const nm = (s.name||'').toLowerCase().replace(/[^a-z]/g,'');
      const v  = parseFloat(s.value);
      if (isNaN(v)) continue;
      if (nm.includes('goal') && !nm.includes('against')) t.goals = v;
      if (nm.includes('assist'))     t.assists   = v;
      if (nm.includes('point') && !nm.includes('pct')) t.points = v;
      if (nm.includes('plusminus'))  t.plusMinus = v;
      if (nm.includes('penaltymin')) t.pim       = v;
      if (nm.includes('hit'))        t.hits      = v;
      if (nm.includes('block'))      t.blocks    = v;
      if (nm.includes('gamesplayed'))t.gp        = v;
    }
  }
  return Object.keys(t).length > 2 ? t : null;
}

async function fetchSoccer(p) {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${p.lk}/athletes/${p.espnId}/statistics`;
  const d = await get(url);
  if (!d) return null;
  const cats = d?.splits?.categories || [];
  const t = {};
  for (const cat of cats) {
    for (const s of (cat.stats||[])) {
      const nm = (s.name||'').toLowerCase().replace(/[^a-z]/g,'');
      const v  = parseFloat(s.value);
      if (isNaN(v)) continue;
      if (nm.includes('goal') && !nm.includes('against')) t.goals = v;
      if (nm.includes('assist'))   t.assists    = v;
      if (nm === 'appearances' || nm === 'gamesplayed') t.apps = v;
      if (nm.includes('shot') && !nm.includes('on'))    t.shots = v;
      if (nm.includes('shotongoal')) t.shotsOn  = v;
      if (nm.includes('minute'))   t.mins       = v;
      if (nm.includes('yellow'))   t.yellowCards= v;
      if (nm.includes('save') && !nm.includes('pct')) t.saves = v;
      if (nm.includes('cleansheet'))  t.cleanSheets = v;
    }
  }
  return Object.keys(t).length > 2 ? t : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const snapshot = { updatedAt: new Date().toISOString(), players: {} };
  let updated = 0, failed = 0;

  for (const p of PLAYERS) {
    let stats = null;
    try {
      if (p.sport === 'nba')                     stats = await fetchNBA(p);
      else if (p.sport === 'nhl' && p.nhlId)     stats = await fetchNHL_nhle(p);
      else if (p.sport === 'nhl' && p.espnId)    stats = await fetchESPNHockey(p);
      else if (p.sport === 'soccer' && p.lk)     stats = await fetchSoccer(p);
    } catch(e) {
      console.error(`  ❌ ${p.id}:`, e.message);
    }

    if (stats) {
      snapshot.players[p.id] = stats;
      console.log(`  ✅ ${p.id.padEnd(12)} ${JSON.stringify(stats).slice(0,80)}`);
      updated++;
    } else {
      console.log(`  ⚠️  ${p.id.padEnd(12)} no data`);
      failed++;
    }
    await sleep(300); // be polite to APIs
  }

  // Write output
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify(snapshot, null, 2));
  console.log(`\n✅ Wrote data/stats.json — ${updated} updated, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
