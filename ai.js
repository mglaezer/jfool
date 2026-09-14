(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.AI = factory(root.Game);
})(typeof self !== 'undefined' ? self : this, function (G) {
  const { SUITS, DECK, HAND_SIZE, LOSING_SCORE, cardPoints, handPoints, matches, legalCards, playCard, takeDraw, cloneState, shuffle } = G;

  // --- Baseline: the original computer player (highest points, most-held suit) ---
  function greedyMove(state, player) {
    const legal = legalCards(state, player);
    const card = legal.reduce((best, c) => cardPoints(c) > cardPoints(best) ? c : best);
    return { card, namedSuit: card.rank === 'Q' ? mostHeldSuit(state.hands[player], card) : null };
  }

  function mostHeldSuit(hand, except) {
    const rest = hand.filter(c => c !== except);
    return SUITS.reduce((best, s) =>
      rest.filter(c => c.suit === s).length > rest.filter(c => c.suit === best).length ? s : best, SUITS[0]);
  }

  // --- Opponent inference: what the opponent's hidden cards cannot be ---
  // Each slot is one hidden card; its constraints are the (top, namedSuit) situations
  // in which that card was in the hand but the opponent had to draw.
  function violates(card, con) {
    return con.top !== null && matches(card, con.top, con.named);
  }

  function opponentSlots(events, me) {
    const opp = 1 - me;
    let slots = [], top = null, named = null, pendingDraw = false;
    for (const e of events || []) {
      if (e.type === 'round') {
        slots = Array.from({ length: HAND_SIZE }, () => []);
        top = null; named = null; pendingDraw = false;
      } else if (e.type === 'play') {
        if (e.player === opp) {
          // A card played right after a draw must be the drawn card, so no slot leaves the hand.
          if (pendingDraw) pendingDraw = false;
          else removeSlot(slots, e.card);
        }
        top = e.card; named = e.namedSuit || null;
      } else if ((e.type === 'draw' || e.type === 'empty') && e.player === opp) {
        const con = { top, named };
        slots.forEach(s => s.push(con));
        pendingDraw = e.type === 'draw';
      } else if (e.type === 'pass' && e.player === opp) {
        if (pendingDraw) slots.push([{ top, named }]);
        pendingDraw = false;
      } else if (e.type === 'seven' && e.player === opp) {
        for (let i = 0; i < e.taken; i++) slots.push([]);
      }
    }
    return slots;
  }

  function removeSlot(slots, card) {
    if (!slots.length) return;
    const consistent = slots.filter(s => !s.some(con => violates(card, con)));
    // Removing the most constrained consistent slot errs toward knowing less, never toward false certainty.
    const pool = consistent.length ? consistent : slots;
    const victim = pool.reduce((a, b) => (consistent.length ? b.length > a.length : b.length < a.length) ? b : a);
    slots.splice(slots.indexOf(victim), 1);
  }

  function unseenCards(state, me) {
    const seen = new Set(state.hands[me].concat(state.discard).map(c => c.id));
    return DECK.filter(c => !seen.has(c.id));
  }

  function sampleWorld(state, me, slots, rng) {
    const opp = 1 - me;
    const pool = unseenCards(state, me);
    // The face-up bottom card of the first deal is still at the bottom of the deck as long as it is unseen and the deck is not empty.
    const bottom = state.bottom && state.deck.length && pool.includes(state.bottom) ? state.bottom : null;
    if (bottom) pool.splice(pool.indexOf(bottom), 1);
    const n = state.hands[opp].length;
    const order = slots.slice(0, n);
    while (order.length < n) order.push([]);
    order.sort((a, b) => b.length - a.length);
    const hand = [];
    for (const s of order) {
      let cands = pool.filter(c => !s.some(con => violates(c, con)));
      if (!cands.length) cands = pool;
      const c = cands[Math.floor(rng() * cands.length)];
      hand.push(c);
      pool.splice(pool.indexOf(c), 1);
    }
    const w = cloneState(state);
    w.hands[opp] = hand;
    w.deck = shuffle(pool, rng);
    if (bottom) w.deck.unshift(bottom);
    return w;
  }

  // Probability-ish view of which suits the opponent is short of, from the slot constraints.
  function suitShortage(slots, oppCount) {
    const short = {};
    for (const s of SUITS) {
      const blocked = slots.filter(sl => sl.some(con => con.top !== null && (con.named || con.top.suit) === s)).length;
      short[s] = oppCount ? blocked / oppCount : 0;
    }
    return short;
  }

  // --- Heuristic policy: the UNO-derived rules of thumb, used as the rollout policy ---
  function candidates(state, player) {
    const out = [];
    for (const c of legalCards(state, player)) {
      if (c.rank === 'Q') SUITS.forEach(s => out.push({ card: c, namedSuit: s }));
      else out.push({ card: c, namedSuit: null });
    }
    return out;
  }

  function scoreMove(state, player, mv, shortage) {
    const { card, namedSuit } = mv;
    const hand = state.hands[player];
    const oppN = state.hands[1 - player].length;
    const rest = hand.filter(c => c !== card);
    if (rest.length === 0) return 1000 + (card.rank === 'Q' ? cardPoints(card) : 0);

    const isQ = card.rank === 'Q';
    const suit = isQ ? namedSuit : card.suit;
    // Liability weight: the bigger my hand relative to the opponent's, the more urgent it is to shed points.
    const pressure = 0.4 + Math.min(1.5, Math.max(0, (hand.length - oppN) * 0.25 + (oppN <= 2 ? 0.5 : 0)));
    let s = cardPoints(card) * pressure;

    const sameSuit = rest.filter(c => c.suit === suit).length;
    const sameRank = isQ ? 0 : rest.filter(c => c.rank === card.rank).length;
    const followUp = rest.some(c => c.suit === suit || (!isQ && c.rank === card.rank));
    if (card.rank === 'A' || card.rank === '7') {
      s += 6 + (followUp ? 10 : 0);
      if (card.rank === '7') s += 5 + (oppN <= 2 ? 25 : oppN <= 3 ? 8 : 0);
    }
    s += 2.5 * sameSuit + 1.5 * sameRank;
    if (shortage) s += 10 * shortage[suit];
    return s;
  }

  function heuristicMove(state, player, rng, shortage) {
    const moves = candidates(state, player);
    let best = null, bestScore = -Infinity;
    for (const mv of moves) {
      const s = scoreMove(state, player, mv, shortage) + rng() * 0.5;
      if (s > bestScore) { bestScore = s; best = mv; }
    }
    return best;
  }

  // --- Monte Carlo player: sample consistent worlds, play them out, pick by softmax ---
  function stepRollout(world, rng) {
    const p = world.current;
    const legal = legalCards(world, p);
    if (legal.length === 0) return takeDraw(world, p);
    const mv = heuristicMove(world, p, rng);
    playCard(world, p, mv.card, mv.namedSuit);
  }

  function netPoints(world, me, base) {
    const opp = 1 - me;
    if (world.roundOver) return (world.scores[opp] - base[opp]) - (world.scores[me] - base[me]);
    return handPoints(world.hands[opp]) - handPoints(world.hands[me]);
  }

  // Chance that the player leading the next round wins the game, by the leader's and the other player's scores
  // in steps of 10. Generated by tools/wintable.js; bilinear interpolation between the nodes is within 0.015 of the full table.
  const WIN_TABLE = [
    [0.505, 0.548, 0.593, 0.641, 0.690, 0.739, 0.788, 0.836, 0.881, 0.921, 0.949],
    [0.463, 0.505, 0.551, 0.600, 0.651, 0.703, 0.756, 0.808, 0.858, 0.904, 0.936],
    [0.418, 0.460, 0.506, 0.555, 0.608, 0.662, 0.718, 0.775, 0.831, 0.883, 0.919],
    [0.370, 0.411, 0.457, 0.506, 0.560, 0.616, 0.675, 0.736, 0.798, 0.857, 0.898],
    [0.321, 0.361, 0.405, 0.454, 0.507, 0.565, 0.626, 0.691, 0.759, 0.824, 0.871],
    [0.271, 0.308, 0.350, 0.397, 0.450, 0.508, 0.571, 0.639, 0.712, 0.784, 0.836],
    [0.221, 0.255, 0.294, 0.338, 0.389, 0.446, 0.509, 0.579, 0.656, 0.735, 0.792],
    [0.173, 0.202, 0.237, 0.277, 0.324, 0.378, 0.440, 0.511, 0.591, 0.674, 0.737],
    [0.126, 0.151, 0.180, 0.214, 0.256, 0.305, 0.364, 0.433, 0.513, 0.600, 0.666],
    [0.084, 0.103, 0.126, 0.154, 0.189, 0.232, 0.285, 0.349, 0.428, 0.515, 0.582],
    [0.056, 0.070, 0.088, 0.111, 0.141, 0.178, 0.226, 0.286, 0.362, 0.448, 0.516],
  ];

  function winChance(scores, me, leader) {
    const a = scores[leader], b = scores[1 - leader];
    if (a >= LOSING_SCORE) return leader === me ? 0 : 1;
    if (b >= LOSING_SCORE) return leader === me ? 1 : 0;
    const x = a / 10, y = b / 10, i = Math.min(Math.floor(x), 9), j = Math.min(Math.floor(y), 9), u = x - i, v = y - j;
    const p = (1 - u) * ((1 - v) * WIN_TABLE[i][j] + v * WIN_TABLE[i][j + 1]) + u * ((1 - v) * WIN_TABLE[i + 1][j] + v * WIN_TABLE[i + 1][j + 1]);
    return leader === me ? p : 1 - p;
  }

  function utility(world, me) {
    return winChance(world.scores, me, world.roundOver ? world.winner : world.current);
  }

  function rollout(world, rng, maxSteps) {
    for (let i = 0; i < maxSteps && !world.roundOver; i++) stepRollout(world, rng);
  }

  const DEFAULTS = { samples: 96, temperature: 0.007, blunderGap: 0.05, maxSteps: 400 };

  // Every candidate move with the player's chance of winning the game after it and the expected round points
  // in the player's favour (positive when the opponent is expected to be charged more).
  function evaluateMoves(state, player, rng, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const moves = candidates(state, player);
    const slots = opponentSlots(state.events, player);
    const base = state.scores.slice();
    const sums = moves.map(() => ({ win: 0, points: 0 }));
    for (let k = 0; k < o.samples; k++) {
      const world = sampleWorld(state, player, slots, rng);
      moves.forEach((mv, i) => {
        const w = cloneState(world);
        playCard(w, player, mv.card, mv.namedSuit);
        rollout(w, rng, o.maxSteps);
        sums[i].win += utility(w, player);
        sums[i].points += netPoints(w, player, base);
      });
    }
    return moves.map((mv, i) => ({ card: mv.card, namedSuit: mv.namedSuit, win: sums[i].win / o.samples, points: sums[i].points / o.samples }));
  }

  function monteCarloMove(state, player, rng, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const moves = candidates(state, player);
    if (moves.length === 1) return moves[0];
    const evals = evaluateMoves(state, player, rng, o);
    return moves[softmaxPick(evals.map(e => e.win), o.temperature, o.blunderGap, rng)];
  }

  function softmaxPick(values, temperature, gap, rng) {
    const best = Math.max(...values);
    const weights = values.map(v => v < best - gap ? 0 : Math.exp((v - best) / temperature));
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return values.indexOf(best);
  }

  return {
    greedyMove, heuristicMove, monteCarloMove, evaluateMoves, candidates, scoreMove,
    opponentSlots, sampleWorld, unseenCards, suitShortage, violates, softmaxPick, winChance, DEFAULTS,
  };
});
