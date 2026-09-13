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

  function newGame(rng, starter) {
    const state = { scores: [0, 0], gameOver: false, loser: null, events: [] };
    startRound(state, starter === undefined ? (rng() < 0.5 ? 0 : 1) : starter, rng);
    return state;
  }

  function startRound(state, starter, rng) {
    state.rng = rng;
    Object.assign(state, {
      deck: shuffle(DECK.slice(), rng), discard: [], hands: [[], []],
      top: null, namedSuit: null, current: starter, drawn: null, roundOver: false, winner: null,
    });
    if (state.events) state.events.length = 0;
    for (let i = 0; i < HAND_SIZE; i++) {
      state.hands[0].push(state.deck.pop());
      state.hands[1].push(state.deck.pop());
    }
    emit(state, { type: 'round', starter });
  }

  function canPlay(state, card) {
    return !state.top || matches(card, state.top, state.namedSuit);
  }

  function legalCards(state, player) {
    if (state.roundOver || state.current !== player) return [];
    if (state.drawn) return canPlay(state, state.drawn) ? [state.drawn] : [];
    return state.hands[player].filter(c => canPlay(state, c));
  }

  function drawInto(state, player) {
    if (state.deck.length === 0) {
      if (state.discard.length <= 1) return null;
      const top = state.discard.pop();
      state.deck = shuffle(state.discard, state.rng);
      state.discard = [top];
      emit(state, { type: 'reshuffle' });
    }
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
    const c = drawInto(state, player);
    emit(state, { type: 'draw', player, card: c });
    if (c && canPlay(state, c)) {
      state.drawn = c;
      return c;
    }
    passTurn(state, player);
    return c;
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
