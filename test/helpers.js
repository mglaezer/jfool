const G = require('../game.js');

function card(name) {
  const c = G.DECK.find(c => G.cardName(c) === name);
  if (!c) throw new Error('no such card ' + name);
  return c;
}

function cards(names) { return names.map(card); }

// Builds a mid-round state. Cards not in hands, discard or the given deck go to the deck.
function makeState({ hands, top = null, namedSuit = null, current = 0, discard = [], deck = null, scores = [0, 0], events = [], seed = 1, lastPlayer = top ? 1 - current : null, bottom = null }) {
  const rng = G.mulberry32(seed);
  const h = [cards(hands[0]), cards(hands[1])];
  const pile = cards(discard);
  if (top && !pile.includes(card(top))) pile.push(card(top));
  const used = new Set(h[0].concat(h[1], pile).map(c => c.id));
  const rest = deck ? cards(deck) : G.shuffle(G.DECK.filter(c => !used.has(c.id)), rng);
  return {
    scores: scores.slice(), gameOver: false, loser: null, events,
    deck: rest, discard: pile, hands: h, top: top ? card(top) : null, namedSuit,
    current, drawn: null, roundOver: false, winner: null, skips: 0, lastPlayer, bottom: bottom ? card(bottom) : null, forced: null,
  };
}

module.exports = { card, cards, makeState };
