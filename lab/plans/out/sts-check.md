# Checking idea recognition against the Strategic Test Suite

1,500 positions chosen by strong players to show 15 strategic themes (100 each), each with its best move. Source: [STS-Rating](https://github.com/fsmosca/STS-Rating), MIT licence. Every ML number is 5-fold cross-validated: each position is judged by a model that never saw it.

## Can the theme be recognised from the position and the best move?

| Method | Accuracy |
|---|---|
| Chance (15 themes, 100 each) | 7% |
| A. hand rules | 61% |
| B. position only (ML) | 20% |
| C. best move only (ML) | 79% |
| D. position + best move (ML) | 80% |

## Per theme (position + best move, ML) and the hand rules

| Theme | ML recall | Rules recall | ML most often confuses it with |
|---|---|---|---|
| 7th Rank | 96% | 100% | Square Vacancy (3) |
| AKPC | 81% | 61% | Undermine (19) |
| AT | 77% | 0% | Square Vacancy (11) |
| Advancement of a/b/c pawns | 87% | 65% | Undermine (13) |
| Bishop vs Knight | 96% | 86% | Simplification (4) |
| Center Control | 60% | 9% | Knight Outposts (19) |
| King Activity | 100% | 100% | 7th Rank (0) |
| Knight Outposts | 79% | 74% | Center Control (10) |
| Offer of Simplification | 52% | 57% | Knight Outposts (22) |
| Open Files and Diagonals | 80% | 51% | AT (7) |
| Pawn Play in the Center | 89% | 48% | Undermine (11) |
| Recapturing | 99% | 86% | Bishop vs Knight (1) |
| Simplification | 85% | 52% | Bishop vs Knight (15) |
| Square Vacancy | 71% | 34% | 7th Rank (10) |
| Undermine | 53% | 97% | Advancement of a/b/c pawns (18) |

## Reading this honestly

- The model is told the best move. Finding the best move is the harder part, which the engine does; this only checks whether we can name the idea behind it.
- STS positions are mostly middlegames and endgames from many openings, not King's Indian positions.
- 100 positions per theme is small; a few points either way is noise.
## The parked plan advisor on the same 1,500 positions

The advisor (js/advisor.js) reads the position only and marks plans "worth doing". Run on every STS position (in the browser):

| Plan the advisor marks "worth doing" | In its own theme | In the other 14 themes |
|---|---|---|
| Rook to an open file | 60% (open files), 81% (7th rank) | 57% to 84%: it says this almost everywhere |
| Knight outpost | 63% (knight outposts) | 15% to 33% |
| Pawn storm | 17% (kingside pawn advance) | 10% to 23%: no better than elsewhere |
| Pawn break | 0% (undermining) | 0%: it is never marked "worth doing" |

When the advisor's own candidates are compared with the expert best move: the best move is one of its listed breaks in 97% of
undermining positions and a pawn on the target wing in 95% of kingside-advance positions, but a knight move to one of its
outposts in only 48% of outpost positions and a rook move to one of its open files in 40% (open files) and 53% (7th rank).

**Conclusion:** judging the plan from the position alone does not work (20% for ML, and the advisor's rules barely separate
themes). Naming the idea behind a strong move works well (80%). So the right order is: the engine finds the good moves, a
model names the idea each one serves, and the trainer teaches those ideas.
