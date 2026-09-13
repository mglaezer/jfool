const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const AI = require('../ai.js');
const { card, makeState } = require('./helpers');

const fixed = () => 0.5;
const ME = 0;

function heuristic(s, player = ME) { return AI.heuristicMove(s, player, fixed); }

test('heuristic: finishes the round when a card can be played as the last one', () => {
  const s = makeState({ hands: [['9♠'], ['7♦', '8♦']], top: '9♥' });
  assert.equal(heuristic(s).card, card('9♠'));
});

test('heuristic: sheds a queen when it fits rather than risk being stuck with it', () => {
  const s = makeState({ hands: [['Q♦', '9♦'], ['7♦', '8♦', '6♣']], top: '6♦' });
  assert.deepEqual(heuristic(s), { card: card('Q♦'), namedSuit: '♦' });
});

test('heuristic: plays an ace before its follow-up card to chain the extra turn', () => {
  const s = makeState({ hands: [['9♠', 'A♠'], ['7♦', '8♦', '6♣', 'K♣']], top: '6♠' });
  assert.equal(heuristic(s).card, card('A♠'));
});

test('heuristic: blocks with a seven when the opponent is down to one card', () => {
  const s = makeState({ hands: [['9♦', '7♦', '8♣'], ['A♣']], top: '6♦' });
  assert.equal(heuristic(s).card, card('7♦'));
});

test('heuristic: names the suit it holds most of', () => {
  const s = makeState({ hands: [['Q♠', '8♥', '9♥', '6♣'], ['7♦', '8♦', '6♠', 'K♣', 'J♣']], top: '10♠' });
  assert.deepEqual(heuristic(s), { card: card('Q♠'), namedSuit: '♥' });
});

test('heuristic: sheds the queen of hearts when the round is nearly lost', () => {
  const s = makeState({ hands: [['Q♥', '6♣', '8♣', '9♣', '10♣', 'J♣'], ['A♠']], top: '6♥' });
  assert.equal(heuristic(s).card, card('Q♥'));
});

test('heuristic: prefers a suit the opponent has been unable to play', () => {
  const s = makeState({ hands: [['9♠', '9♥'], ['7♦', '8♦', '6♣']], top: '9♦' });
  const shortage = { '♠': 0, '♥': 1, '♦': 0, '♣': 0 };
  assert.equal(AI.heuristicMove(s, ME, fixed, shortage).card, card('9♥'));
});

test('inference: a draw and pass mark every hidden card as unable to match', () => {
  const events = [
    { type: 'round', starter: 0 },
    { type: 'play', player: 0, card: card('9♠'), namedSuit: null },
    { type: 'draw', player: 1 },
    { type: 'pass', player: 1 },
  ];
  const slots = AI.opponentSlots(events, ME);
  assert.equal(slots.length, 6);
  const s = makeState({ hands: [['6♦', '7♦'], ['6♥', '7♥', '8♥', '10♥', 'J♥', 'K♥']], top: '9♠', events });
  const rng = G.mulberry32(3);
  for (let i = 0; i < 40; i++) {
    const w = AI.sampleWorld(s, ME, slots, rng);
    assert.equal(w.hands[1].length, 6);
    for (const c of w.hands[1]) {
      assert.notEqual(c.suit, '♠');
      assert.notEqual(c.rank, '9');
    }
    const all = w.deck.concat(w.hands[1]);
    assert.equal(new Set(all.map(c => c.id)).size, all.length);
    assert.ok(!all.some(c => s.hands[0].includes(c) || s.discard.includes(c)));
  }
});

test('sampling keeps the face-up bottom card at the bottom of the deck', () => {
  const s = makeState({ hands: [['6♦', '7♦'], ['6♥', '7♥', '8♥']], top: '9♠', bottom: '9♦' });
  const rng = G.mulberry32(4);
  for (let i = 0; i < 30; i++) {
    const w = AI.sampleWorld(s, ME, [], rng);
    assert.equal(w.deck[0], card('9♦'));
    assert.ok(!w.hands[1].includes(card('9♦')));
  }
});

test('inference: a card played right after a draw is the drawn card', () => {
  const events = [
    { type: 'round', starter: 0 },
    { type: 'play', player: 0, card: card('9♠'), namedSuit: null },
    { type: 'draw', player: 1 },
    { type: 'play', player: 1, card: card('9♥'), namedSuit: null },
  ];
  const slots = AI.opponentSlots(events, ME);
  assert.equal(slots.length, 5);
  assert.ok(slots.every(s => s.length === 1));
});

test('inference: cards taken from a seven are unconstrained and a queen names the constraining suit', () => {
  const events = [
    { type: 'round', starter: 0 },
    { type: 'play', player: 0, card: card('Q♠'), namedSuit: '♣' },
    { type: 'draw', player: 1 },
    { type: 'pass', player: 1 },
    { type: 'play', player: 0, card: card('7♣'), namedSuit: null },
    { type: 'seven', player: 1, taken: 2 },
  ];
  const slots = AI.opponentSlots(events, ME);
  assert.equal(slots.length, 8);
  assert.equal(slots.filter(s => s.length === 0).length, 2);
  assert.ok(AI.violates(card('8♣'), slots[0][0]));
  assert.ok(!AI.violates(card('8♠'), slots[0][0]));
  const shortage = AI.suitShortage(slots, 8);
  assert.equal(shortage['♣'], 6 / 8);
  assert.equal(shortage['♠'], 0);
});

test('inference: a skip on an empty deck constrains every hidden card without adding one', () => {
  const events = [
    { type: 'round', starter: 0 },
    { type: 'play', player: 0, card: card('9♠'), namedSuit: null },
    { type: 'empty', player: 1 },
  ];
  const slots = AI.opponentSlots(events, ME);
  assert.equal(slots.length, 5);
  assert.ok(slots.every(s => s.length === 1 && AI.violates(card('6♠'), s[0])));
});

test('inference: a played card removes one hidden slot', () => {
  const events = [
    { type: 'round', starter: 1 },
    { type: 'play', player: 1, card: card('9♠'), namedSuit: null },
  ];
  assert.equal(AI.opponentSlots(events, ME).length, 4);
});

function playRound(state, policies, rng) {
  for (let i = 0; i < 1000 && !state.roundOver; i++) {
    const p = state.current;
    const legal = G.legalCards(state, p);
    if (!legal.length) { G.takeDraw(state, p); continue; }
    const mv = policies[p](state, p);
    G.playCard(state, p, mv.card, mv.namedSuit);
  }
}

function tournament(policyA, policyB, rounds, seed) {
  const rng = G.mulberry32(seed);
  const result = { winsA: 0, pointsA: 0, pointsB: 0 };
  for (let r = 0; r < rounds; r++) {
    const s = G.newGame(rng, r % 2);
    const flip = r % 4 >= 2;
    const policies = flip ? [policyB, policyA] : [policyA, policyB];
    playRound(s, policies, rng);
    const a = flip ? 1 : 0;
    if (s.winner === a) result.winsA++;
    result.pointsA += s.scores[a];
    result.pointsB += s.scores[1 - a];
  }
  return result;
}

const fast = { samples: 24 };

// Measured over 1000 rounds: MC(96) beats greedy 60% and concedes ~9 points per round vs ~16.
test('monte carlo beats the greedy baseline over many rounds', () => {
  const rng = G.mulberry32(11);
  const mc = (s, p) => AI.monteCarloMove(s, p, rng, { samples: 48 });
  const r = tournament(mc, AI.greedyMove, 300, 5);
  assert.ok(r.winsA / 300 > 0.52, `win rate ${r.winsA / 300}`);
  assert.ok(r.pointsA * 1.2 < r.pointsB, `points ${r.pointsA} vs ${r.pointsB}`);
});

// Measured over 6000 rounds: the heuristic alone only edges greedy (52%); the strength comes from the rollouts.
test('heuristic is no worse than the greedy baseline', () => {
  const rng = G.mulberry32(12);
  const h = (s, p) => AI.heuristicMove(s, p, rng);
  const r = tournament(h, AI.greedyMove, 2000, 6);
  assert.ok(r.winsA / 2000 >= 0.5, `win rate ${r.winsA / 2000}`);
});

// Measured over 1000 rounds: MC(96) beats the heuristic 63% and concedes ~6 points per round vs ~17.
test('monte carlo beats the heuristic it rolls out with', () => {
  const rng = G.mulberry32(13);
  const mc = (s, p) => AI.monteCarloMove(s, p, rng, { samples: 48 });
  const h = (s, p) => AI.heuristicMove(s, p, rng);
  const r = tournament(mc, h, 400, 7);
  assert.ok(r.winsA / 400 > 0.52, `win rate ${r.winsA / 400}`);
  assert.ok(r.pointsA * 1.3 < r.pointsB, `points ${r.pointsA} vs ${r.pointsB}`);
});

test('monte carlo leaves a suit the opponent is known to lack', () => {
  const events = [
    { type: 'round', starter: 0 },
    { type: 'play', player: 0, card: card('6♠'), namedSuit: null },
    { type: 'draw', player: 1 },
    { type: 'pass', player: 1 },
    { type: 'play', player: 0, card: card('8♠'), namedSuit: null },
    { type: 'draw', player: 1 },
    { type: 'pass', player: 1 },
    { type: 'play', player: 0, card: card('9♦'), namedSuit: null },
    { type: 'play', player: 1, card: card('9♣'), namedSuit: null },
  ];
  const s = makeState({ hands: [['9♠', '9♥', 'K♣'], ['6♥', '7♥', '8♥', '10♥', 'J♥', '10♣']], top: '9♣', discard: ['6♠', '8♠', '9♦', '9♣'], events });
  const rng = G.mulberry32(17);
  let spades = 0;
  for (let i = 0; i < 20; i++) if (AI.monteCarloMove(s, ME, rng, { samples: 48 }).card === card('9♠')) spades++;
  assert.ok(spades >= 15, `chose the spade ${spades}/20 times`);
});

test('monte carlo is reproducible with the same seed', () => {
  const s = makeState({ hands: [['8♠', '9♠', 'A♦', 'Q♣'], ['7♦', '8♦', '6♣']], top: '6♠' });
  const a = AI.monteCarloMove(s, ME, G.mulberry32(99), fast);
  const b = AI.monteCarloMove(s, ME, G.mulberry32(99), fast);
  assert.deepEqual(a, b);
});

test('monte carlo varies its choice between near-equal moves', () => {
  const s = makeState({ hands: [['8♠', '9♠', '10♠'], ['7♦', '8♦', '6♣', 'K♣', 'J♥']], top: '6♠' });
  const rng = G.mulberry32(5);
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(AI.monteCarloMove(s, ME, rng, fast).card);
  assert.ok(seen.size >= 2, `only ${seen.size} distinct choices`);
});

test('monte carlo never picks a clear blunder: ace then the last card wins the game on the spot', () => {
  const s = makeState({ hands: [['A♠', '6♠'], ['7♦']], top: '8♠', scores: [95, 95] });
  const rng = G.mulberry32(8);
  for (let i = 0; i < 20; i++) {
    const mv = AI.monteCarloMove(s, ME, rng, fast);
    assert.equal(mv.card, card('A♠'));
  }
});

test('monte carlo decides quickly at browser settings', () => {
  const s = makeState({ hands: [['8♠', '9♠', 'A♦', 'Q♣', '7♠'], ['7♦', '8♦', '6♣', 'K♣', 'J♥']], top: '6♠' });
  const rng = G.mulberry32(21);
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) AI.monteCarloMove(s, ME, rng);
  const ms = (Date.now() - t0) / 10;
  assert.ok(ms < 250, `${ms} ms per decision`);
});

test('softmax pick never chooses a move far below the best', () => {
  const rng = G.mulberry32(1);
  for (let i = 0; i < 200; i++) assert.notEqual(AI.softmaxPick([0, 0.01, -1], 0.05, 0.35, rng), 2);
});

test('monte carlo never looks at the opponent hand or the deck order', () => {
  const mine = ['8♠', '9♠', 'A♦', 'Q♣', '7♠'];
  const a = makeState({ hands: [mine, ['7♦', '8♦', '6♣', 'K♣', 'J♥']], top: '6♠', deck: ['10♥', '9♣', 'J♦', 'K♠'] });
  const b = makeState({ hands: [mine, ['10♥', '9♣', 'J♦', 'K♠', '7♦']], top: '6♠', deck: ['8♦', '6♣', 'K♣', 'J♥'] });
  for (let seed = 1; seed <= 10; seed++) {
    assert.deepEqual(AI.monteCarloMove(a, ME, G.mulberry32(seed), fast), AI.monteCarloMove(b, ME, G.mulberry32(seed), fast));
  }
});
