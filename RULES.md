# Rules

## Setup

- Two players: you and the computer.
- The deck has 36 cards: 6, 7, 8, 9, 10, Jack, Queen, King, Ace in each of the four suits.
- Each player is dealt 5 cards. The rest forms the draw pile.
- The starting player of the first round is chosen at random. In later rounds the winner of the previous round starts.

## Playing

- The first card of a round can be any card.
- After that, a played card must match the **suit** or the **value** of the card on top of the discard pile.
- You may only draw when you have no playable card. You draw one card from the deck: if it is playable you must play it, otherwise your turn ends.
- When the deck runs out, the discard pile (except the top card) is shuffled to form a new deck.

## Special cards

- **Ace**: the next player skips a turn (you play again).
- **7**: the next player takes 2 cards from the deck and skips a turn (you play again).
- **Queen**: must match the top card by suit or rank like any other card. The player then names a suit, and the next card must be of that suit (or another Queen).

## Scoring

The round ends when one player runs out of cards. The other player's remaining cards are counted:

| Card | Points |
|------|--------|
| 6–10 | face value |
| Jack | 2 |
| King | 4 |
| Ace | 11 |
| Queen | 20 |
| Queen of hearts | 40 |

If the winner finished the round with a Queen, the winner's score is reduced by 20 (or 40 for the Queen of hearts), but not below 0.

Scores accumulate across rounds. The first player to reach **101 points loses** the game.

## How to play

Open `index.html` in a browser. Playable cards are highlighted; click one to play it. When you have no playable card, click the deck to draw.
