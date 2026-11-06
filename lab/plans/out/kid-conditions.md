# When does a pawn storm work? (King's Indian, both kings castled by move 12)

639,314 side-positions from real games. The side "stormed" if, from move 13 to 25, it made more pawn moves on the wing where the enemy king castled than anywhere else, and at least two. Overall 27% did.

For each condition the table gives, for the side in question:

- **Storm result**: how storming games score compared with what the rating gap predicts (percentage points, 95% margin).
- **No-storm result**: the same for games in the same condition that did not storm.
- **Benefit of storming**: storm minus no-storm, in the same condition. Positive means storming beat the alternatives here.
- **Engine**: change in Stockfish's evaluation from move 12 to 25 for storming games where we have engine data (pawns, ± 95% margin).

## Kings on the same side or opposite

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| kings on opposite sides | 160,960 | 38% | -0.6 ± 0.4 | +0.2 ± 0.3 | **-0.8 ± 0.5** | -0.23 ± 0.14 (3,234) |
| kings on the same side | 478,354 | 24% | -1.5 ± 0.3 | +0.5 ± 0.2 | **-2.0 ± 0.3** | -0.27 ± 0.09 (6,046) |

## Centre at move 12

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| locked | 95,027 | 41% | -0.3 ± 0.5 | +0.7 ± 0.4 | **-1.0 ± 0.6** | -0.13 ± 0.15 (2,091) |
| open | 206,863 | 22% | -2.5 ± 0.4 | +0.4 ± 0.2 | **-2.9 ± 0.5** | -0.27 ± 0.16 (2,334) |
| semi-open | 179,355 | 28% | -1.1 ± 0.4 | +0.2 ± 0.3 | **-1.4 ± 0.5** | -0.29 ± 0.14 (2,641) |
| tension | 158,069 | 27% | -0.9 ± 0.5 | +0.5 ± 0.3 | **-1.4 ± 0.5** | -0.31 ± 0.16 (2,214) |

## Attackers minus defenders, counting pieces that can reach the king zone in one move (weights Q4, R2, B2, N2), in four equal groups

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| 1 most defended (≤ -10) | 235,632 | 29% | -1.0 ± 0.4 | +0.2 ± 0.2 | **-1.2 ± 0.4** | -0.16 ± 0.12 (3,565) |
| 2 (up to -8) | 137,574 | 27% | -1.6 ± 0.5 | +0.3 ± 0.3 | **-1.9 ± 0.6** | -0.28 ± 0.17 (1,911) |
| 3 (up to -6) | 124,491 | 27% | -0.9 ± 0.5 | +0.4 ± 0.3 | **-1.3 ± 0.6** | -0.37 ± 0.17 (1,868) |
| 4 most attacked (> -6) | 141,617 | 26% | -1.5 ± 0.5 | +1.0 ± 0.3 | **-2.4 ± 0.6** | -0.29 ± 0.17 (1,936) |

## How many of my pieces can reach the enemy king zone within one move

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| 0 pieces | 36,061 | 33% | -1.0 ± 0.9 | -0.0 ± 0.6 | **-1.0 ± 1.0** | -0.09 ± 0.29 (618) |
| 1 pieces | 185,278 | 30% | -0.8 ± 0.4 | +0.3 ± 0.3 | **-1.1 ± 0.5** | -0.28 ± 0.13 (2,964) |
| 2 pieces | 261,848 | 27% | -1.5 ± 0.4 | +0.4 ± 0.2 | **-1.9 ± 0.4** | -0.26 ± 0.12 (3,708) |
| 3 pieces | 131,269 | 24% | -1.4 ± 0.5 | +0.6 ± 0.3 | **-1.9 ± 0.6** | -0.29 ± 0.18 (1,700) |
| 4+ pieces | 24,858 | 23% | -1.6 ± 1.2 | +1.2 ± 0.7 | **-2.8 ± 1.4** | -0.09 ± 0.46 (290) |

## How many of their pieces can reach the defence of their king within one move

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| 3 pieces | 15,831 | 28% | +0.1 ± 1.4 | +1.9 ± 0.9 | **-1.8 ± 1.6** | -0.27 ± 0.48 (250) |
| 4+ pieces | 622,405 | 27% | -1.3 ± 0.2 | +0.4 ± 0.1 | **-1.6 ± 0.3** | -0.25 ± 0.08 (9,006) |

## Attackers minus defenders hitting the zone right now (the earlier, cruder measure), in four equal groups

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| 1 most defended (≤ -10) | 289,576 | 28% | -1.2 ± 0.3 | +0.3 ± 0.2 | **-1.5 ± 0.4** | -0.14 ± 0.11 (4,257) |
| 2 (up to -8) | 163,207 | 27% | -1.3 ± 0.5 | +0.5 ± 0.3 | **-1.8 ± 0.5** | -0.30 ± 0.15 (2,269) |
| 3 (up to -6) | 114,053 | 27% | -0.8 ± 0.5 | +0.7 ± 0.3 | **-1.6 ± 0.6** | -0.33 ± 0.19 (1,612) |
| 4 most attacked (> -6) | 72,478 | 29% | -1.7 ± 0.6 | +0.3 ± 0.4 | **-2.0 ± 0.8** | -0.47 ± 0.23 (1,142) |

## The race: own pawn advance on the target wing minus their advance on my king's wing

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| ahead by 3+ | 27,954 | 47% | +0.9 ± 0.8 | -1.8 ± 0.8 | **+2.7 ± 1.1** | +0.37 ± 0.27 (717) |
| behind by 3+ | 27,954 | 26% | -2.6 ± 1.1 | +1.6 ± 0.7 | **-4.2 ± 1.3** | -0.53 ± 0.38 (416) |
| level (-2 to 2) | 458,460 | 24% | -1.4 ± 0.3 | +0.5 ± 0.2 | **-1.9 ± 0.3** | -0.24 ± 0.09 (5,846) |

## Enemy king's pawn shield (pawns in front of the king)

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| enemy shield 1 | 43,839 | 37% | -0.7 ± 0.7 | +0.4 ± 0.6 | **-1.1 ± 0.9** | -0.17 ± 0.27 (908) |
| enemy shield 2 | 125,507 | 29% | -0.7 ± 0.5 | +0.8 ± 0.3 | **-1.5 ± 0.6** | -0.34 ± 0.17 (1,996) |
| enemy shield 3 | 467,741 | 26% | -1.4 ± 0.3 | +0.3 ± 0.2 | **-1.7 ± 0.3** | -0.24 ± 0.09 (6,348) |

## How far my pawns have already advanced on the target wing

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| 1 to 3 squares | 480,078 | 26% | -1.3 ± 0.3 | +0.3 ± 0.2 | **-1.6 ± 0.3** | -0.27 ± 0.09 (6,668) |
| 4+ squares | 31,786 | 51% | +2.0 ± 0.7 | -0.9 ± 0.8 | **+2.9 ± 1.1** | +0.19 ± 0.26 (874) |
| not started (0) | 127,450 | 26% | -2.6 ± 0.5 | +1.0 ± 0.3 | **-3.6 ± 0.6** | -0.43 ± 0.18 (1,738) |

## Enemy fianchetto bishop

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| enemy fianchetto bishop | 393,283 | 26% | -1.1 ± 0.3 | +1.2 ± 0.2 | **-2.3 ± 0.3** | -0.31 ± 0.10 (5,370) |
| no enemy fianchetto | 246,031 | 30% | -1.4 ± 0.3 | -0.9 ± 0.2 | **-0.5 ± 0.4** | -0.18 ± 0.12 (3,910) |

## Queens on the board

| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |
|---|---|---|---|---|---|---|
| both | 604,107 | 28% | -1.2 ± 0.2 | +0.4 ± 0.1 | **-1.6 ± 0.3** | -0.25 ± 0.08 (8,834) |
| none | 31,238 | 24% | -1.8 ± 1.1 | +0.6 ± 0.6 | **-2.5 ± 1.2** | -0.26 ± 0.30 (403) |
| one side | 3,969 | 23% | -2.5 ± 3.1 | +1.6 ± 1.7 | **-4.2 ± 3.5** | too few |

## The textbook recipe together

Same side castling, locked centre, attackers at least level with defenders, and not behind in the race.

| Group | Games | Storm rate | Benefit of storming |
|---|---|---|---|
| recipe holds | 644 | 51% | **+5.5 ± 7.2** |
| recipe does not hold | 638,670 | 27% | **-1.7 ± 0.3** |

## Reading this honestly

- Conditions are measured at move 12, but the storm is chosen over the next 13 moves, so "benefit" mixes the plan with the player who chose it. Stronger players pick plans better, which the rating adjustment only partly removes.
- "Attackers" and "defenders" count knights, bishops, rooks and queens that hit the king zone now or after one move. At move 12 the defenders almost always include nearly every piece, so that side barely varies; the measure ignores pawn lines that a storm would open.
- Margins are 95%. A benefit smaller than its margin is not a finding.
