# Pawn breaks (King's Indian)

783,964 side-positions (each game that reaches move 25, both sides). A **break** is a pawn push that lands next to an enemy pawn so it attacks it. **Available** breaks are those the side could play at move 12; **supported** means my attackers on the landing square at least equal theirs. **Played** means a break was played between moves 13 and 25.

Columns: **Result** = score against what the rating gap predicts, in points (95% margin); **vs reference** = difference from the reference group named in each section; **Wins a pawn** = net pawns won by move 25; **Engine** = Stockfish evaluation change, in pawns.

## A. With a break available, is playing one better than waiting?

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| break available, none played (reference) | 359,190 | +0.6 ± 0.2 |  | 33% | +0.08 ± 0.05 (18,779) |
| break available, one played | 347,461 | -0.5 ± 0.2 | -1.2 ± 0.2 | 26% | -0.07 ± 0.05 (17,998) |
| no break available | 77,313 | -0.5 ± 0.3 | -1.1 ± 0.4 | 27% | -0.04 ± 0.11 (4,023) |

## B. Does support matter? (best available break at move 12)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| **unsupported best break (margin below 0)** | | | | | |
|   not played (reference) | 150,840 | +0.2 ± 0.2 |  | 30% | +0.05 ± 0.08 (7,790) |
|   played | 87,880 | -1.2 ± 0.3 | -1.4 ± 0.4 | 22% | -0.19 ± 0.10 (4,585) |
| **level (0)** | | | | | |
|   not played (reference) | 91,027 | +0.8 ± 0.3 |  | 33% | -0.06 ± 0.11 (4,767) |
|   played | 89,721 | -0.1 ± 0.3 | -0.9 ± 0.4 | 25% | -0.12 ± 0.11 (4,580) |
| **well supported (1 or more)** | | | | | |
|   not played (reference) | 117,323 | +1.0 ± 0.3 |  | 36% | +0.21 ± 0.09 (6,222) |
|   played | 169,860 | -0.4 ± 0.2 | -1.5 ± 0.4 | 27% | +0.01 ± 0.07 (8,833) |

## C. Which break? (the first one played, by landing file; reference: break available but none played)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| **Black** | | | | | |
|   a-file break first | 15,178 | -1.7 ± 0.8 | -2.4 ± 0.8 | 28% | +0.04 ± 0.24 (752) |
|   b-file break first | 41,253 | -1.2 ± 0.5 | -1.8 ± 0.5 | 29% | +0.26 ± 0.15 (2,129) |
|   c-file break first | 24,761 | -2.9 ± 0.6 | -3.5 ± 0.6 | 28% | -0.20 ± 0.19 (1,301) |
|   d-file break first | 12,269 | -1.8 ± 0.8 | -2.4 ± 0.9 | 26% | -0.09 ± 0.28 (668) |
|   e-file break first | 26,983 | -1.9 ± 0.6 | -2.5 ± 0.6 | 30% | +0.18 ± 0.20 (1,399) |
|   f-file break first | 59,380 | -2.1 ± 0.4 | -2.8 ± 0.4 | 26% | -0.10 ± 0.12 (3,006) |
|   g-file break first | 11,449 | -0.8 ± 0.9 | -1.5 ± 0.9 | 19% | -0.08 ± 0.27 (619) |
|   h-file break first | 6,317 | -1.4 ± 1.2 | -2.1 ± 1.2 | 27% | +0.15 ± 0.36 (352) |
| **White** | | | | | |
|   a-file break first | 6,433 | +1.9 ± 1.2 | +1.3 ± 1.2 | 27% | +0.02 ± 0.37 (330) |
|   b-file break first | 25,784 | +0.7 ± 0.6 | +0.1 ± 0.6 | 22% | -0.15 ± 0.16 (1,289) |
|   c-file break first | 26,081 | +2.3 ± 0.6 | +1.7 ± 0.6 | 27% | +0.05 ± 0.18 (1,319) |
|   d-file break first | 10,822 | +2.5 ± 0.9 | +1.8 ± 0.9 | 25% | -0.19 ± 0.31 (558) |
|   e-file break first | 24,938 | +2.6 ± 0.6 | +2.0 ± 0.6 | 21% | -0.22 ± 0.21 (1,274) |
|   f-file break first | 36,964 | -1.0 ± 0.5 | -1.6 ± 0.5 | 21% | -0.36 ± 0.17 (1,985) |
|   g-file break first | 13,165 | -1.4 ± 0.8 | -2.0 ± 0.8 | 23% | -0.49 ± 0.26 (705) |
|   h-file break first | 24,145 | +0.4 ± 0.6 | -0.3 ± 0.6 | 25% | -0.12 ± 0.22 (1,295) |

## D. Timing of the first break (reference: none played)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| immediately (moves 13 to 14) | 93,648 | -0.2 ± 0.3 | -0.9 ± 0.3 | 27% | -0.01 ± 0.11 (4,836) |
| moves 15 to 17 | 107,174 | -0.2 ± 0.3 | -0.8 ± 0.3 | 26% | +0.07 ± 0.10 (5,537) |
| moves 18 to 21 | 98,416 | -0.8 ± 0.3 | -1.4 ± 0.3 | 25% | -0.13 ± 0.10 (5,101) |
| late (moves 22 to 25) | 66,684 | -1.6 ± 0.4 | -2.2 ± 0.4 | 23% | -0.34 ± 0.11 (3,507) |

## E. By centre at move 12 (benefit of playing a break, with a break available)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| **locked centre** | | | | | |
|   none played (reference) | 32,375 | +0.2 ± 0.5 |  | 31% | -0.04 ± 0.17 (1,705) |
|   played | 74,208 | +0.1 ± 0.3 | -0.1 ± 0.6 | 25% | -0.00 ± 0.11 (3,865) |
| **tension centre** | | | | | |
|   none played (reference) | 99,462 | +0.3 ± 0.3 |  | 33% | +0.07 ± 0.11 (5,158) |
|   played | 79,351 | -0.4 ± 0.3 | -0.7 ± 0.4 | 26% | -0.08 ± 0.11 (4,091) |
| **semi-open centre** | | | | | |
|   none played (reference) | 97,863 | +0.7 ± 0.3 |  | 32% | +0.11 ± 0.10 (5,038) |
|   played | 100,503 | -0.6 ± 0.3 | -1.3 ± 0.4 | 26% | -0.09 ± 0.10 (5,191) |
| **open centre** | | | | | |
|   none played (reference) | 129,490 | +0.9 ± 0.3 |  | 33% | +0.09 ± 0.09 (6,878) |
|   played | 93,399 | -1.1 ± 0.3 | -2.1 ± 0.4 | 26% | -0.10 ± 0.10 (4,851) |

## F. How many supported breaks were available at move 12? (reference: none available)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| none supported (reference) | 316,033 | -0.3 ± 0.2 |  | 27% | -0.04 ± 0.06 (16,398) |
| 1 supported | 284,175 | +0.2 ± 0.2 | +0.6 ± 0.2 | 30% | -0.01 ± 0.06 (14,849) |
| 2 supported | 129,546 | +0.5 ± 0.3 | +0.8 ± 0.3 | 31% | +0.09 ± 0.09 (6,756) |
| 3 or more supported | 54,210 | -0.3 ± 0.4 | +0.1 ± 0.4 | 32% | +0.05 ± 0.14 (2,797) |

## G. Same starting position quality: break available at move 12, split by the engine's evaluation then (engine sample only)

| Group | Positions | Result | vs reference | Wins a pawn | Engine |
|---|---|---|---|---|---|
| **clearly worse (engine -50 or lower)** | | | | | |
|   none played (reference) | 6,323 | -4.8 ± 1.2 |  | 30% | +0.31 ± 0.10 (6,323) |
|   played | 6,853 | -6.0 ± 1.1 | -1.2 ± 1.6 | 24% | +0.05 ± 0.08 (6,853) |
| **about equal (-49 to +49)** | | | | | |
|   none played (reference) | 5,376 | +0.5 ± 1.3 |  | 31% | +0.09 ± 0.10 (5,376) |
|   played | 5,002 | -0.7 ± 1.3 | -1.2 ± 1.8 | 25% | -0.07 ± 0.10 (5,002) |
| **clearly better (+50 or higher)** | | | | | |
|   none played (reference) | 7,080 | +6.2 ± 1.1 |  | 36% | -0.13 ± 0.09 (7,080) |
|   played | 6,143 | +4.9 ± 1.2 | -1.3 ± 1.6 | 28% | -0.21 ± 0.09 (6,143) |

## Reading this honestly

- Whether a side plays a break is a choice made over the next 13 moves; players who find a good one may simply be better.
- "Support" counts all attackers and defenders on the landing square at move 12; it does not see what the pieces will do next.
- A break pushed by a pawn that is later recaptured still counts as a break played.
