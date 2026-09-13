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

  function utility(world, me, base) {
    const opp = 1 - me;
    if (world.roundOver) {
      const my = world.scores[me], other = world.scores[opp];
      let u = ((other - base[opp]) - (my - base[me])) / 40;
      if (my >= LOSING_SCORE) u -= 3;
      else if (other >= LOSING_SCORE) u += 3;
      return u;
    }
    return (handPoints(world.hands[opp]) - handPoints(world.hands[me])) / 40;
  }

  function rollout(world, me, rng, base, maxSteps) {
    for (let i = 0; i < maxSteps && !world.roundOver; i++) stepRollout(world, rng);
    return utility(world, me, base);
  }

  const DEFAULTS = { samples: 96, temperature: 0.05, blunderGap: 0.35, maxSteps: 400 };

  function monteCarloMove(state, player, rng, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const moves = candidates(state, player);
    if (moves.length === 1) return moves[0];
    const slots = opponentSlots(state.events, player);
    const base = state.scores.slice();
    const totals = new Array(moves.length).fill(0);
    for (let k = 0; k < o.samples; k++) {
      const world = sampleWorld(state, player, slots, rng);
      moves.forEach((mv, i) => {
        const w = cloneState(world);
        playCard(w, player, mv.card, mv.namedSuit);
        totals[i] += rollout(w, player, rng, base, o.maxSteps);
      });
    }
    const means = totals.map(t => t / o.samples);
    return moves[softmaxPick(means, o.temperature, o.blunderGap, rng)];
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
    greedyMove, heuristicMove, monteCarloMove, candidates, scoreMove,
    opponentSlots, sampleWorld, unseenCards, suitShortage, violates, softmaxPick, utility, DEFAULTS,
  };
});
