# Engine check: did the plan help? (King's Indian sample)

20,400 games from the sample reach move 25 and have evaluations (Stockfish, depth 12, centipawns, 100 = about a pawn). Each row is how much the evaluation moved between move 12 and move 25, from that side's point of view. Positive means the side improved its position while carrying out that plan. The margin is 95%.

Win-rate and engine verdicts differ because humans blunder: this table asks whether a plan is sound, not whether it scores.

## White

| Plan | Games | Eval change (cp) | Lost over a pawn | Gained over a pawn |
|---|---|---|---|---|
| quiet | 8,188 | -15 ± 8 | 39% | 36% |
| attack on their king | 5,525 | -37 ± 10 | 42% | 35% |
| play on the other wing | 5,342 | -1 ± 9 | 34% | 36% |
| central play | 1,345 | +22 ± 21 | 34% | 43% |

## Black

| Plan | Games | Eval change (cp) | Lost over a pawn | Gained over a pawn |
|---|---|---|---|---|
| quiet | 11,345 | +19 ± 7 | 36% | 39% |
| attack on their king | 3,755 | -8 ± 11 | 39% | 35% |
| play on the other wing | 3,562 | +10 ± 11 | 33% | 36% |
| central play | 1,738 | +50 ± 18 | 34% | 42% |

## Either side, by castling
| Plan | Castling | Games | Eval change (cp) |
|---|---|---|---|
| quiet | not both castled | 9,446 | +5 ± 8 |
| attack on their king | not both castled | 2,301 | -43 ± 16 |
| play on the other wing | not both castled | 1,374 | +4 ± 17 |
| central play | not both castled | 983 | +45 ± 26 |
| attack on their king | opposite sides | 933 | +26 ± 26 |
| quiet | opposite sides | 580 | -10 ± 35 |
| quiet | same side | 9,507 | +5 ± 7 |
| play on the other wing | same side | 7,239 | +6 ± 7 |
| attack on their king | same side | 6,046 | -27 ± 9 |
| central play | same side | 2,006 | +38 ± 17 |

## Plan against plan (change from White's side)
| White plan | Black plan | Games | Eval change (cp) |
|---|---|---|---|
| quiet | quiet | 4,948 | -20 ± 11 |
| attack on their king | quiet | 3,212 | -43 ± 14 |
| play on the other wing | quiet | 2,460 | +2 ± 13 |
| play on the other wing | play on the other wing | 1,619 | -7 ± 15 |
| attack on their king | attack on their king | 1,345 | -15 ± 19 |
| quiet | attack on their king | 1,281 | +18 ± 20 |
| quiet | play on the other wing | 1,182 | -19 ± 19 |
| play on the other wing | attack on their king | 915 | +15 ± 20 |
| quiet | central play | 777 | -34 ± 27 |
| central play | quiet | 725 | +27 ± 30 |

## Reading this honestly

- Depth 12 is a quick look. It is fine for "does the evaluation drift" and not for single positions.
- Evaluation at move 25 includes the players' mistakes, so this measures what the plan led to in practice.
- The plan label is a rough pawn-move rule. Piece play is not captured.
