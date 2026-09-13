const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const { card, cards, makeState } = require('./helpers');

test('deals 5 cards each from a unique 36-card deck', () => {
  const s = G.newGame(G.mulberry32(7), 0);
  assert.equal(s.hands[0].length, 5);
  assert.equal(s.hands[1].length, 5);
  assert.equal(s.deck.length, 26);
  const ids = new Set(s.deck.concat(s.hands[0], s.hands[1]).map(c => c.id));
  assert.equal(ids.size, 36);
});

test('first round: the lowest card of the bottom card suit leads and must be played', () => {
  const s = G.newGame(G.mulberry32(1));
  assert.equal(s.bottom, card('K♦'));
  assert.equal(s.deck[0], card('K♦'));
  assert.deepEqual(s.hands[0].filter(c => c.suit === '♦'), cards(['10♦', '6♦']));
  assert.deepEqual(s.hands[1].filter(c => c.suit === '♦'), cards(['8♦', 'A♦']));
  assert.equal(s.current, 0);
  assert.deepEqual(G.legalCards(s, 0), [card('6♦')]);
  assert.throws(() => G.playCard(s, 0, card('10♦')));
  G.playCard(s, 0, card('6♦'));
  assert.equal(s.forced, null);
  assert.deepEqual(s.events[0], { type: 'round', starter: 0, bottom: card('K♦') });
});

test('first round: a deal where nobody holds the bottom suit is redone', () => {
  const s = G.newGame(G.mulberry32(8));
  assert.deepEqual(s.events[0], { type: 'redeal', suit: '♣' });
  assert.equal(s.bottom, card('8♣'));
  assert.equal(s.forced, card('6♣'));
  assert.equal(s.deck.length, 26);
});

test('later rounds start with the winner and any card', () => {
  const s = G.newGame(G.mulberry32(1));
  G.startRound(s, 1, G.mulberry32(2));
  assert.equal(s.current, 1);
  assert.equal(s.bottom, null);
  assert.deepEqual(G.legalCards(s, 1), s.hands[1]);
});

test('first move allows any card', () => {
  const s = makeState({ hands: [['6♠', 'Q♥', 'A♣'], ['7♦']] });
  assert.deepEqual(G.legalCards(s, 0), cards(['6♠', 'Q♥', 'A♣']));
});

test('a card must match suit or rank, a queen included', () => {
  const s = makeState({ hands: [['6♠', '9♥', '9♦', 'Q♣', 'K♣'], ['7♦']], top: '9♠' });
  assert.deepEqual(G.legalCards(s, 0), cards(['6♠', '9♥', '9♦']));
});

test('a queen is playable on its own suit or on another queen', () => {
  const s = makeState({ hands: [['Q♠', 'Q♥', '6♦'], ['7♦']], top: 'Q♦', namedSuit: '♣' });
  assert.deepEqual(G.legalCards(s, 0), cards(['Q♠', 'Q♥']));
  const t = makeState({ hands: [['Q♠', 'Q♥', '6♦'], ['7♦']], top: '8♠' });
  assert.deepEqual(G.legalCards(t, 0), cards(['Q♠']));
});

test('after a queen only the named suit or another queen is playable', () => {
  const s = makeState({ hands: [['9♠', '6♥', 'Q♦', 'Q♣'], ['7♦']], top: 'Q♠', namedSuit: '♥' });
  assert.deepEqual(G.legalCards(s, 0), cards(['6♥', 'Q♦', 'Q♣']));
});

test('a normal card passes the turn', () => {
  const s = makeState({ hands: [['6♠', '9♠'], ['7♦']], top: '8♠' });
  G.playCard(s, 0, card('6♠'));
  assert.equal(s.current, 1);
  assert.equal(s.top, card('6♠'));
  assert.equal(s.namedSuit, null);
});

test('an ace keeps the turn with the player who played it', () => {
  const s = makeState({ hands: [['A♠', '9♠'], ['7♦']], top: '8♠' });
  G.playCard(s, 0, card('A♠'));
  assert.equal(s.current, 0);
  assert.deepEqual(s.events.at(-1), { type: 'skip', player: 1 });
});

test('a seven makes the opponent take two cards and keeps the turn', () => {
  const s = makeState({ hands: [['7♠', '9♠'], ['7♦']], top: '8♠' });
  G.playCard(s, 0, card('7♠'));
  assert.equal(s.current, 0);
  assert.equal(s.hands[1].length, 3);
  assert.deepEqual(s.events.at(-1), { type: 'seven', player: 1, taken: 2 });
});

test('a queen names a suit', () => {
  const s = makeState({ hands: [['Q♠', '9♠'], ['7♦']], top: '8♠' });
  assert.throws(() => G.playCard(s, 0, card('Q♠')));
  G.playCard(s, 0, card('Q♠'), '♦');
  assert.equal(s.namedSuit, '♦');
  assert.equal(s.current, 1);
});

test('illegal moves throw', () => {
  const s = makeState({ hands: [['6♦', '9♠'], ['7♦']], top: '8♠' });
  assert.throws(() => G.playCard(s, 0, card('6♦')));
  assert.throws(() => G.playCard(s, 1, card('7♦')));
});

test('drawing an unplayable card passes the turn', () => {
  const s = makeState({ hands: [['6♦'], ['7♦']], top: '8♠', deck: ['9♥'] });
  const c = G.takeDraw(s, 0);
  assert.equal(c, card('9♥'));
  assert.equal(s.hands[0].length, 2);
  assert.equal(s.current, 1);
  assert.equal(s.drawn, null);
});

test('a drawn playable card must be played: no other card, no pass', () => {
  const s = makeState({ hands: [['6♦'], ['7♦']], top: '8♠', deck: ['9♠'] });
  G.takeDraw(s, 0);
  assert.equal(s.current, 0);
  assert.deepEqual(G.legalCards(s, 0), [card('9♠')]);
  assert.throws(() => G.passTurn(s, 0));
  assert.throws(() => G.playCard(s, 0, card('6♦')));
  G.playCard(s, 0, card('9♠'));
  assert.equal(s.current, 1);
  assert.equal(s.hands[0].length, 1);
});

test('drawing is not allowed while a legal move exists', () => {
  const s = makeState({ hands: [['6♠'], ['7♦']], top: '8♠', deck: ['9♠'] });
  assert.throws(() => G.takeDraw(s, 0));
});

test('cannot draw while holding a playable card', () => {
  const s = makeState({ hands: [['6♠'], ['7♦']], top: '8♠' });
  assert.throws(() => G.takeDraw(s, 0));
});

test('with an empty deck a player without a legal card skips without drawing', () => {
  const s = makeState({ hands: [['6♦'], ['7♦']], top: '8♠', discard: ['9♥', '10♥', '8♠'], deck: [] });
  assert.equal(G.takeDraw(s, 0), null);
  assert.equal(s.hands[0].length, 1);
  assert.equal(s.current, 1);
  assert.deepEqual(s.deck, []);
  assert.deepEqual(s.events.at(-1), { type: 'empty', player: 0 });
});

test('two skips in a row turn the pile over unshuffled and give the turn to the player after the last to play', () => {
  const s = makeState({ hands: [['6♦'], ['7♦']], top: '8♠', discard: ['9♥', '10♥', '8♠'], deck: [], lastPlayer: 0 });
  G.takeDraw(s, 0);
  G.takeDraw(s, 1);
  assert.deepEqual(s.events.at(-1), { type: 'flip' });
  assert.deepEqual(s.discard, [card('8♠')]);
  assert.equal(s.current, 1);
  assert.equal(G.takeDraw(s, 1), card('9♥'));
  assert.equal(s.current, 0);
});

test('a card played between two skips restarts the count', () => {
  const s = makeState({ hands: [['6♦'], ['7♦', '8♣']], top: '8♠', discard: ['9♥', '8♠'], deck: [] });
  G.takeDraw(s, 0);
  G.playCard(s, 1, card('8♣'));
  G.takeDraw(s, 0);
  assert.deepEqual(s.deck, []);
  G.takeDraw(s, 1);
  assert.deepEqual(s.events.at(-1), { type: 'flip' });
  assert.deepEqual(s.deck.map(G.cardName), ['8♠', '9♥']);
});

test('a seven with a short deck takes what is left', () => {
  const s = makeState({ hands: [['7♠', '9♠'], ['7♦']], top: '8♠', deck: ['9♥'] });
  G.playCard(s, 0, card('7♠'));
  assert.equal(s.hands[1].length, 2);
  assert.deepEqual(s.events.at(-1), { type: 'seven', player: 1, taken: 1 });
  assert.equal(s.skips, 0);
});

test('round scoring counts the loser hand and rewards a queen finish', () => {
  const s = makeState({ hands: [['Q♥'], ['K♠', 'J♦', 'A♣', '10♥', 'Q♠']], top: '8♥', scores: [50, 0] });
  G.playCard(s, 0, card('Q♥'), '♠');
  assert.equal(s.roundOver, true);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.scores, [10, 4 + 2 + 11 + 10 + 20]);
  assert.equal(s.events.at(-1).bonus, 40);
});

test('a queen finish cannot take the score below zero', () => {
  const s = makeState({ hands: [['Q♠'], ['9♦']], top: '8♠', scores: [15, 0] });
  G.playCard(s, 0, card('Q♠'), '♠');
  assert.deepEqual(s.scores, [0, 9]);
  assert.equal(s.events.at(-1).bonus, 15);
});

test('reaching 101 ends the game and names the loser', () => {
  const s = makeState({ hands: [['6♠'], ['Q♥', '9♦']], top: '8♠', scores: [0, 70] });
  G.playCard(s, 0, card('6♠'));
  assert.equal(s.scores[1], 119);
  assert.equal(s.gameOver, true);
  assert.equal(s.loser, 1);
});

test('every full game keeps all 36 cards unique', () => {
  const rng = G.mulberry32(42);
  for (let g = 0; g < 50; g++) {
    const s = G.newGame(rng);
    for (let step = 0; step < 3000 && !s.gameOver; step++) {
      if (s.roundOver) { G.startRound(s, s.winner, rng); continue; }
      const p = s.current;
      const legal = G.legalCards(s, p);
      if (legal.length) G.playCard(s, p, legal[0], '♠');
      else G.takeDraw(s, p);
      const all = s.deck.concat(s.discard, s.hands[0], s.hands[1]);
      assert.equal(all.length, 36);
      assert.equal(new Set(all.map(c => c.id)).size, 36);
    }
  }
});
