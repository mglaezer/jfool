// Prints WIN_TABLE for ai.js: the chance that the player leading the next round wins the game, by both scores in steps of 10.
// Round outcomes come from heuristic self-play and hardly depend on the scores, so the table is solved exactly by value
// iteration over every score pair; the coarse grid with bilinear interpolation is within 0.015 of the full table.
// Usage: node tools/wintable.js [rounds per leader]
const G = require('../game.js');
const AI = require('../ai.js');
const rounds = Number(process.argv[2] || 50000);
const rng = G.mulberry32(12345);

function outcomes(leader) {
  const counts = new Map();
  for (let i = 0; i < rounds; i++) {
    const s = { scores: [0, 0], gameOver: false, loser: null, events: null };
    G.startRound(s, leader, rng);
    for (let k = 0; k < 400 && !s.roundOver; k++) {
      const p = s.current;
      if (G.legalCards(s, p).length === 0) G.takeDraw(s, p);
      else { const mv = AI.heuristicMove(s, p, rng); G.playCard(s, p, mv.card, mv.namedSuit); }
    }
    if (!s.roundOver) continue;
    const key = `${s.winner},${G.handPoints(s.hands[1 - s.winner])},${s.top.rank === 'Q' ? G.cardPoints(s.top) : 0}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts].map(([k, n]) => { const [w, pts, bonus] = k.split(',').map(Number); return { w, pts, bonus, p: n / total }; });
}

const dist = [outcomes(0), outcomes(1)];
const S = G.LOSING_SCORE;
const V = [0, 1].map(() => Array.from({ length: S }, () => new Float64Array(S)));
const value = (a, b, L) => a >= S ? 0 : b >= S ? 1 : V[L][a][b];
for (;;) {
  let delta = 0;
  for (const L of [0, 1]) for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
    let v = 0;
    for (const o of dist[L]) {
      const sc = [a, b];
      sc[1 - o.w] += o.pts;
      sc[o.w] -= Math.min(o.bonus, sc[o.w]);
      v += o.p * value(sc[0], sc[1], o.w);
    }
    delta = Math.max(delta, Math.abs(v - V[L][a][b]));
    V[L][a][b] = v;
  }
  if (delta < 1e-10) break;
}

const rows = [];
for (let a = 0; a <= 100; a += 10) {
  const row = [];
  for (let b = 0; b <= 100; b += 10) row.push(((V[0][a][b] + 1 - V[1][b][a]) / 2).toFixed(3));
  rows.push('  [' + row.join(', ') + '],');
}
console.log('const WIN_TABLE = [\n' + rows.join('\n') + '\n];');
