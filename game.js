(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Game = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const LOSING_SCORE = 101;
  const HAND_SIZE = 5;
  const DECK = [];
  SUITS.forEach(suit => RANKS.forEach(rank => DECK.push({ id: DECK.length, rank, suit })));

  function cardPoints(c) {
    if (c.rank === 'Q') return c.suit === '♥' ? 40 : 20;
    if (c.rank === 'K') return 4;
    if (c.rank === 'J') return 2;
    if (c.rank === 'A') return 11;
    return Number(c.rank);
  }

  function cardName(c) { return c.rank + c.suit; }

  function handPoints(hand) { return hand.reduce((s, c) => s + cardPoints(c), 0); }

  function mulberry32(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function matches(card, top, namedSuit) {
    if (namedSuit) return card.suit === namedSuit || card.rank === 'Q';
    return card.suit === top.suit || card.rank === top.rank;
  }

  function emit(state, event) {
    if (state.events) state.events.push(event);
  }

  function newGame(rng, starter = null) {
    const state = { scores: [0, 0], gameOver: false, loser: null, events: [] };
    startRound(state, starter, rng);
    return state;
  }

  function lowestOfSuit(hand, suit) {
    return hand.filter(c => c.suit === suit).sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank))[0] || null;
  }

  // Without a starter (the first round) the bottom card of the deck is turned up and the player
  // holding the lowest card of its suit leads with that card; a deal where nobody has the suit is redone.
  function startRound(state, starter, rng) {
    if (state.events) state.events.length = 0;
    let bottom = null, forced = null;
    for (;;) {
      Object.assign(state, {
        deck: shuffle(DECK.slice(), rng), discard: [], hands: [[], []],
        top: null, namedSuit: null, drawn: null, roundOver: false, winner: null, skips: 0, lastPlayer: null,
      });
      for (let i = 0; i < HAND_SIZE; i++) {
        state.hands[0].push(state.deck.pop());
        state.hands[1].push(state.deck.pop());
      }
      if (starter !== null) break;
      bottom = state.deck[0];
      const lowest = state.hands.map(h => lowestOfSuit(h, bottom.suit));
      if (lowest[0] || lowest[1]) {
        starter = lowest[0] && (!lowest[1] || RANKS.indexOf(lowest[0].rank) < RANKS.indexOf(lowest[1].rank)) ? 0 : 1;
        forced = lowest[starter];
        break;
      }
      emit(state, { type: 'redeal', suit: bottom.suit });
    }
    Object.assign(state, { current: starter, bottom, forced });
    emit(state, { type: 'round', starter, bottom });
  }

  function canPlay(state, card) {
    return !state.top || matches(card, state.top, state.namedSuit);
  }

  function legalCards(state, player) {
    if (state.roundOver || state.current !== player) return [];
    if (state.drawn) return canPlay(state, state.drawn) ? [state.drawn] : [];
    if (state.forced) return [state.forced];
    return state.hands[player].filter(c => canPlay(state, c));
  }

  function drawInto(state, player) {
    if (state.deck.length === 0) return null;
    const c = state.deck.pop();
    state.hands[player].push(c);
    return c;
  }

  function playCard(state, player, card, namedSuit) {
    if (!legalCards(state, player).includes(card)) throw new Error('illegal move: ' + cardName(card));
    if (card.rank === 'Q' && !SUITS.includes(namedSuit)) throw new Error('queen needs a suit');
    const hand = state.hands[player];
    hand.splice(hand.indexOf(card), 1);
    state.discard.push(card);
    state.top = card;
    state.namedSuit = card.rank === 'Q' ? namedSuit : null;
    state.drawn = null;
    state.forced = null;
    state.skips = 0;
    state.lastPlayer = player;
    emit(state, { type: 'play', player, card, namedSuit: state.namedSuit });
    if (hand.length === 0) return endRound(state, player);
    const other = 1 - player;
    if (card.rank === 'A') {
      emit(state, { type: 'skip', player: other });
    } else if (card.rank === '7') {
      const taken = [drawInto(state, other), drawInto(state, other)].filter(Boolean).length;
      emit(state, { type: 'seven', player: other, taken });
    } else {
      state.current = other;
    }
  }

  function takeDraw(state, player) {
    if (state.roundOver || state.current !== player || state.drawn) throw new Error('cannot draw now');
    if (legalCards(state, player).length) throw new Error('must play a legal card');
    if (state.deck.length === 0) {
      emit(state, { type: 'empty', player });
      state.current = 1 - player;
      if (++state.skips === 2) flipDiscard(state);
      return null;
    }
    const c = drawInto(state, player);
    emit(state, { type: 'draw', player, card: c });
    if (canPlay(state, c)) {
      state.drawn = c;
      return c;
    }
    passTurn(state, player);
    return c;
  }

  // The pile is turned over unshuffled, so the first card played is the first one drawn.
  function flipDiscard(state) {
    const top = state.discard.pop();
    state.deck = state.discard.reverse();
    state.discard = [top];
    state.skips = 0;
    state.current = 1 - state.lastPlayer;
    emit(state, { type: 'flip' });
  }

  function passTurn(state, player) {
    if (state.roundOver || state.current !== player) throw new Error('cannot pass now');
    if (state.drawn) throw new Error('must play the drawn card');
    state.drawn = null;
    state.current = 1 - player;
    emit(state, { type: 'pass', player });
  }

  function endRound(state, winner) {
    const loser = 1 - winner;
    const points = handPoints(state.hands[loser]);
    const bonus = state.top.rank === 'Q' ? Math.min(cardPoints(state.top), state.scores[winner]) : 0;
    state.scores[loser] += points;
    state.scores[winner] -= bonus;
    state.roundOver = true;
    state.winner = winner;
    const busted = state.scores.findIndex(s => s >= LOSING_SCORE);
    if (busted !== -1) {
      state.gameOver = true;
      state.loser = busted;
    }
    emit(state, { type: 'end', winner, points, bonus });
  }

  function cloneState(state) {
    return Object.assign({}, state, {
      deck: state.deck.slice(), discard: state.discard.slice(),
      hands: [state.hands[0].slice(), state.hands[1].slice()],
      scores: state.scores.slice(), events: null,
    });
  }

  return {
    SUITS, RANKS, DECK, LOSING_SCORE, HAND_SIZE,
    cardPoints, cardName, handPoints, mulberry32, shuffle, matches,
    newGame, startRound, canPlay, legalCards, playCard, takeDraw, passTurn, cloneState,
  };
});
