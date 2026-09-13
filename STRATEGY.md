# Computer player strategy

The computer's decisions live in `ai.js`; the rules engine in `game.js`. `AI.monteCarloMove` is what the browser uses.

## 1. Sources

UNO advice that transfers, since both games share "match suit or rank, action cards, points for cards left in hand":

- [Gamerules: UNO strategy](https://gamerules.com/uno-strategy/) – get rid of high-point cards early, hold wilds for the end, use draw/skip cards when the opponent is close to going out, track which colours the opponent cannot play.
- [TheGamer: best UNO strategies](https://www.thegamer.com/uno-card-game-best-strategies-to-win/) – steer play toward the colour you hold most, do not waste action cards while the opponent has many cards, bluff and vary your play so the opponent cannot read your hand.
- [Two-player UNO rules](https://playunogame.com/uno_game_rules_2_players/) – in two-player play a skip or reverse returns the turn to the player who used it, so action cards chain into extra turns. Our Ace and 7 work the same way.
- [AI Factory: Perfect Information Monte Carlo](https://www.aifactory.co.uk/newsletter/2011_02_pimc.htm) – the determinisation method used below: sample hidden cards, solve each sample as if it were open, average.
- Opponent modelling for card games with hidden hands (e.g. [arXiv: opponent modeling in imperfect-information games](https://arxiv.org/abs/2010.05004)) – infer what the opponent does *not* hold from the turns on which they could not play.

## 2. Shape of the game

- Two players, so every action card is an extra turn for whoever plays it. Ace = free turn; 7 = free turn plus the opponent gains at least 13 points of liability on average.
- Points are only scored by the loser, so a card in hand is a liability weighted by its value: a Queen is 20 (Q♥ 40), an Ace 11, a King 4, a Jack 2.
- The Queen matches like any other card but lets you name the next suit, and it is the only card that reduces the winner's score (never below zero) when it finishes a round. It is the most expensive card to be stuck with, and getting stuck is easy: only its own suit or another Queen lets it out.
- The deck is small (36 cards) and is reshuffled from the discard pile, so card counting works: everything not in my hand or the discard pile is either in the opponent's hand or the deck.

## 3. Decision procedure: Perfect Information Monte Carlo

For each legal move (Queens are expanded into four moves, one per named suit):

1. Sample an opponent hand consistent with what has been observed (section 4), plus a random deck order from the remaining unseen cards.
2. Play the move, then play the rest of the round out with the heuristic policy (section 5) for both players.
3. Score the finished round as the point differential (opponent's gain minus mine, divided by 40), with a large bonus or penalty if the round ends the game.

Ninety-six samples are averaged per move (a few milliseconds in the browser; the tests assert under 250 ms). The move is then chosen by softmax over the average utilities, not by argmax (section 6).

Why this rather than a hand-written decision tree: the interactions between "keep a follow-up card for after my Ace", "the opponent is short of spades", and "the Queen finishing bonus" are easy to state but hard to weight by hand. The rollouts weight them by playing them out.

## 4. Inference: what the opponent cannot hold

`opponentSlots` replays the round's event log. Each hidden opponent card is a slot with a list of constraints. When the opponent has to draw, the card on top (and any named suit) at that moment is added as a constraint to every slot then in the hand: none of those cards match it. A card played straight after a draw is the drawn card, so no slot is consumed. Cards drawn from a 7 are new, unconstrained slots. When a card is played from the hand, the slot removed is the most constrained one that is consistent with the card, so the model errs toward knowing less rather than assuming more.

`sampleWorld` fills slots from the unseen cards, most constrained first, respecting the constraints. This is what lets the computer play into a suit the opponent has shown they lack (there is a test for exactly that), and avoid naming a suit they have shown they hold.

`suitShortage` turns the same constraints into a per-suit "fraction of the opponent's hand known not to match" and is available to the heuristic.

### How long the knowledge lasts, and why it is not made "probabilistic"

The constraints are hard facts, not hints: under the rules (no drawing with a legal card in hand, a drawn card that fits must be played) the opponent could not have held a matching card at that moment. They stay attached to those cards until the cards leave the hand, so the memory lasts the whole round, and it is cleared when a new round is dealt. The only approximation is which slot to drop when the opponent plays a card; the "most constrained consistent slot" rule is close to the Bayesian answer, because a more constrained slot has fewer candidate cards and is therefore the more likely source of any given card.

Measured against the heuristic opponent (about 2500 rounds, 32 samples per estimate): the computer's belief that the opponent holds a suit they once drew against, by how many of their plays have passed since the draw.

| Opponent plays since the draw | Belief | Truth |
|---|---|---|
| 0 | 0.06 | 0.06 |
| 1 | 0.10 | 0.10 |
| 2 | 0.18 | 0.18 |
| 3 | 0.28 | 0.26 |
| 4 or more | 0.49 | 0.47 |

Without the inference the belief would sit near 0.5 in every row. The residual error is about two points, so decaying the constraints or weighting them probabilistically would not add information.

Soft evidence does exist, but it is *positive* evidence and depends on how the opponent plays:

- After naming a suit with a Queen the opponent holds it with certainty, and roughly 74 %, 61 %, 61 %, 56 % after one to four more plays; the model believes 74 %, 60 %, 55 %, 54 %.
- Following suit or switching suit by rank shifts the chance they still hold the previous suit by 7 to 14 points relative to the model.

A prototype that biased samples toward hands holding the named suit changed nothing beyond noise over 3000 rounds (59 % baseline versus 57 to 58 %): suit naming is too rare per round for the extra knowledge to matter, and the behavioural signals are unreliable against a human. The inference is therefore left exact and unweighted.

## 5. Heuristic policy (rollouts, and the UNO rules of thumb)

`scoreMove` ranks a move by:

- **Liability**: card points times a pressure factor. Pressure rises when my hand is larger than the opponent's and when the opponent is down to two cards, i.e. when losing the round is likely, dump points fast.
- **Action cards**: Ace and 7 get a bonus, doubled when I hold a follow-up card of the same suit or rank (a chain of turns). The 7 gets a large extra bonus when the opponent has two or three cards left, because two forced draws then often stop them going out.
- **Steering**: bonus per card I keep in the same suit or rank (I will still have a play next turn), and a bonus for suits the opponent is short of.
- **Queen**: treated as points to shed whenever it fits, since it can only be played on its own suit or on another Queen and is 20 or 40 points if it stays. Finishing with a Queen is scored above everything else, since it also cuts my score. Whether to hold it back for that bonus is left to the rollouts, which weigh the bonus against the chance of a matching top card.
- **Naming a suit**: the suit is chosen by the same scorer, so it prefers the suit I hold most and the opponent lacks.

A small random jitter on every score breaks ties so rollouts do not all play the same line.

## 6. Unpredictability and psychology

- **Softmax with a blunder gap**: moves within 0.35 (about 14 points) of the best are eligible; among them selection is by softmax with temperature 0.05. Near-equal moves are mixed, so the human cannot infer the computer's hand from a deterministic tie-break, but a clearly better move is never passed over. The tests check both: variety between near-equal moves, and a guaranteed finish when finishing is possible.
- **Mixed suit naming**: because the Queen is scored once per suit, the named suit is drawn from the same distribution, so it does not always reveal the computer's longest suit.
- **Delay**: the browser waits 450–1050 ms before each computer move, so thinking time leaks nothing about the difficulty of the decision.
- **Bluffing that is not worth it**: deliberately playing off-suit to mislead costs tempo and was not adopted; in a 36-card two-player game with a small hand the rollouts show the information gained by the opponent is worth less than the card.

## 7. Measured strength

Tournaments in `test/ai.test.js`, hundreds of rounds per pairing, fixed seeds:

| Matchup | Win rate | Points conceded per round |
|---|---|---|
| Heuristic vs greedy (old computer: highest card first) | 52 % | 11.3 vs 11.7 |
| Monte Carlo (24 samples) vs greedy | 55 % | 11.5 vs 14.7 |
| Monte Carlo (96 samples, browser setting) vs greedy | 60 % | 8.7 vs 16.2 |
| Monte Carlo (96) vs heuristic | 63 % | 6.3 vs 17.4 |

Rounds in this game are noisy (the deal decides a lot), so win rate understates the gap; conceded points show it more clearly. With the Queen bound by the matching rule, "highest card first" is already a reasonable policy, so the heuristic alone barely beats it; the sampling and rollouts are where the strength comes from.

## 8. Limits

- A drawn card that fits must be played, so a draw followed by a pass proves the drawn card did not match; the inference relies on that rule.
- Rollouts use the heuristic for the human too; a human who plays very differently is modelled less accurately, but the averaged utilities remain a sound estimate of a round's value.
