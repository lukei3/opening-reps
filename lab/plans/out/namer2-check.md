# Idea namer v2: trained on expert labels, checked on human comments

Trained on 3,706 expert-labelled best moves: the Strategic Test Suite and the WGM-reviewed positional puzzles. 24 ideas have enough examples for their own model.

## 1. Inside the expert data (5-fold cross-validation)

Top idea correct: **71%**. Right idea among the top three: **92%**.

| Source | Top idea correct | In top three |
|---|---|---|
| positional-puzzles | 67% | 91% |
| sts | 76% | 94% |

| Idea | Expert examples | AUC (1.0 perfect, 0.5 guessing) |
|---|---|---|
| seventh_rank | 100 | 1.00 |
| bishop_vs_knight | 100 | 1.00 |
| queenside_pawns | 100 | 0.99 |
| kingside_pawns | 100 | 0.99 |
| centre_pawns | 100 | 0.99 |
| knight_outpost | 100 | 0.99 |
| endgame_technique | 308 | 0.98 |
| open_file | 100 | 0.97 |
| space | 568 | 0.97 |
| pawn_break | 100 | 0.96 |
| square_vacancy | 100 | 0.95 |
| king_activity | 100 | 0.95 |
| avoid_exchange | 100 | 0.94 |
| recapture | 100 | 0.93 |
| centre_control | 309 | 0.90 |
| coordination | 808 | 0.90 |
| king_safety | 147 | 0.88 |
| restriction | 741 | 0.86 |
| development | 366 | 0.85 |
| fix_structure | 102 | 0.84 |
| initiative | 575 | 0.84 |
| exchange | 406 | 0.84 |
| prophylaxis | 155 | 0.81 |
| weakness | 88 | 0.78 |

## 2. Outside check: human comments the model never saw

For every comment that names an idea, the model scores the commented move. AUC compares those moves with all other commented moves from the same source: 0.5 means the model cannot tell them apart, 1.0 means it always ranks the named moves higher.

| Source | Commented moves | Idea named in comment | Comments naming it | AUC |
|---|---|---|---|---|
| book-capablanca | 360 | development | 40 | 0.73 |
| book-capablanca | 360 | exchange | 18 | 0.71 |

Weighted average AUC across all checks: **0.72**.

## Reading this honestly

- Comment labels come from words in the text ("outpost", "open file", "pawn break"). A comment can mention an idea without the move serving it, so this check is noisy and the true agreement is higher than it shows, not lower.
- Expert sets are small (3,700 moves). Ideas with few examples are the least reliable.
- The namer is told the move. Finding a good move is the engine's job.
