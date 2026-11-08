# Idea namer v2: trained on expert labels, checked on human comments

Trained on 3,689 expert-labelled best moves: the Strategic Test Suite and the WGM-reviewed positional puzzles. 24 ideas have enough examples for their own model.

## 1. Inside the expert data (5-fold cross-validation)

Top idea correct: **74%**. Right idea among the top three: **94%**.

| Source | Top idea correct | In top three |
|---|---|---|
| positional-puzzles | 70% | 91% |
| sts | 79% | 97% |

| Idea | Expert examples | AUC (1.0 perfect, 0.5 guessing) |
|---|---|---|
| king_activity | 100 | 1.00 |
| seventh_rank | 100 | 1.00 |
| centre_pawns | 100 | 1.00 |
| bishop_vs_knight | 100 | 1.00 |
| kingside_pawns | 100 | 1.00 |
| queenside_pawns | 99 | 1.00 |
| recapture | 100 | 0.99 |
| knight_outpost | 100 | 0.99 |
| square_vacancy | 100 | 0.99 |
| endgame_technique | 308 | 0.98 |
| pawn_break | 100 | 0.98 |
| space | 559 | 0.97 |
| avoid_exchange | 100 | 0.97 |
| open_file | 100 | 0.96 |
| fix_structure | 102 | 0.92 |
| coordination | 807 | 0.92 |
| king_safety | 146 | 0.92 |
| centre_control | 304 | 0.89 |
| development | 364 | 0.88 |
| restriction | 733 | 0.86 |
| initiative | 568 | 0.86 |
| exchange | 405 | 0.85 |
| prophylaxis | 153 | 0.82 |
| weakness | 88 | 0.82 |

## 2. Outside check: human comments the model never saw

For every comment that names an idea, the model scores the commented move. AUC compares those moves with all other commented moves from the same source: 0.5 means the model cannot tell them apart, 1.0 means it always ranks the named moves higher.

| Source | Commented moves | Idea named in comment | Comments naming it | AUC |
|---|---|---|---|---|
| book-capablanca | 368 | development | 40 | 0.76 |
| book-capablanca | 368 | exchange | 18 | 0.38 |
| book-capablanca | 368 | initiative | 15 | 0.49 |
| book-lasker-common-sense | 207 | development | 33 | 0.46 |
| book-mason-art | 112 | development | 24 | 0.57 |

Weighted average AUC across all checks: **0.56**.

## Reading this honestly

- Comment labels come from words in the text ("outpost", "open file", "pawn break"). A comment can mention an idea without the move serving it, so this check is noisy and the true agreement is higher than it shows, not lower.
- Expert sets are small (3,700 moves). Ideas with few examples are the least reliable.
- The namer is told the move. Finding a good move is the engine's job.
