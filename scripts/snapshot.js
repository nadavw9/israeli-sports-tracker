#!/usr/bin/env node
// scripts/snapshot.js
// Fetches live stats for NBA, NHL, and Soccer players via public ESPN + NHL APIs.
// Run by GitHub Actions every 2 hours. No CORS issues here — pure Node.
// Output: data/stats.json  (loaded by index.html on init)

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── HTTP helper ────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'israeli-athletes-tracker/1.0' } }, r => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => { try { res(JSON.parse(body)); } catch(e) { res(null); } });
    }).on('error', () => res(null));
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Player list ─────────────────────────────────────────────────────────────
// Only players with a working live API endpoint.
// bball / handball / tennis / winter have no free public API → marked Est. in UI.
const PLAYERS = [
  // NBA — ESPN overview API
  { id: 'avdija',    sport: 'nba',    espnId: '4683021' },
  { id: 'saraf',     sport: 'nba',    espnId: '5242502' },
  { id: 'wolf',      sport: 'nba',    espnId: '5107173' },

  // NHL — NHL.com API (primary) + ESPN fallback
  { id: 'zbuium',    sport: 'nhl',    nhlId: 8484798, espnId: '5206893' },

  // Soccer — ESPN stats API with correct league keys
  { id: 'gloukh',    sport: 'soccer', espnId: '5048073', lk: 'ned.1'           }, // Ajax
  { id: 'solomon',   sport: 'soccer', espnId: '272985',  lk: 'ita.1'           }, // Fiorentina
  { id: 'dperetz',   sport: 'soccer', espnId: '305926',  lk: 'eng.2'           }, // Southampton
  { id: 'khalili',   sport: 'soccer', espnId: '5049812', lk: 'bel.1'           }, // Union SG
  { id: 'dasa',      sport: 'soccer', espnId: '330553',  lk: 'ned.1'           }, // NEC Nijmegen
  { id: 'weissman',  sport: 'soccer', espnId: '358942',  lk: 'aut.1'           }, // Blau-Weiss Linz
  { id: 'glazer',    sport: 'soccer', espnId: '252814',  lk: 'srb.1'           }, // Red Star Belgrade
  { id: 'lemkin',    sport: 'soccer', espnId: '313070',  lk: 'ned.1'           }, // FC Twente
  { id: 'nachmias',  sport: 'soccer', espnId: '313169',  lk: 'bul.1'           }, // Ludogorets
  { id: 'ddavid',    sport: 'soccer', espnId: '3945812', lk: 'jpn.1'           }, // Yokohama FM
  { id: 'abada',     sport: 'soccer', espnId: '312976',  lk: 'usa.1'           }, // Charlotte FC
  { id: 'turgeman',  sport: 'soccer', espnId: '4886065', lk: 'usa.1'           }, // NE Revolution
  { id: 'feingold',  sport: 'soccer', espnId: '4727482', lk: 'usa.1'           }, // NE Revolution
  { id: 'toklomati', sport: 'soccer', espnId: '4742301', lk: 'usa.1'           }, // Charlotte FC
  { id: 'nlavi',     sport: 'soccer', espnId: '3941093', lk: 'jpn.1'           }, // Machida Zelvia
];

// ─── Fetchers ─────────────────────────────────────────────────────────────
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
      if (nm === 'fieldgoalpercentage')           t.fgp = +(v*100).toFixed(1);
      if (nm === 'threepointfieldgoalpercentage') t.tpp = +(v*100).toFixed(1);
      if (nm === 'freethrowpercentage')            t.ftp = +(v*100).toFixed(1);
    }
  }
  return Object.keys(t).length > 3 ? t : null;
}

async function fetchNHL(p) {
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
      if (nm.includes('goal') && !nm.includes('against'))   t.goals      = v;
      if (nm.includes('assist'))                             t.assists    = v;
      if (nm === 'appearances' || nm === 'gamesplayed')      t.apps       = v;
      if (nm.includes('minute'))                             t.mins       = v;
      if (nm.includes('yellow'))                             t.yellowCards= v;
      if (nm.includes('save') && !nm.includes('pct'))        t.saves      = v;
      if (nm.includes('cleansheet'))                         t.cleanSheets= v;
    }
  }
  return Object.keys(t).length > 2 ? t : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date().toISOString();
  const snapshot = { updatedAt: now, players: {} };
  let updated = 0, failed = 0;

  for (const p of PLAYERS) {
    let stats = null;
    try {
      if (p.sport === 'nba')                stats = await fetchNBA(p);
      else if (p.sport === 'nhl' && p.nhlId) stats = await fetchNHL(p);
      else if (p.sport === 'soccer' && p.lk) stats = await fetchSoccer(p);
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
    await sleep(300);
  }

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify(snapshot, null, 2));
  console.log(`\n✅ data/stats.json written — ${updated} updated, ${failed} no data`);
}

main().catch(e => { console.error(e); process.exit(1); });
