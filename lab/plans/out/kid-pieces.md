# Pieces and outposts (King's Indian)

783,964 side-positions, each game that reaches move 25, both sides. Measured at move 12 unless stated. **Result** = score against the rating prediction, in points (95% margin). **vs reference** = difference from the group marked as reference. **Engine** = Stockfish evaluation change from move 12 to 25, in pawns.

An **outpost** is a square in the enemy half (ranks 4 to 6 from the side's view) guarded by one of its pawns that no enemy pawn can ever attack.

## A. Outposts available at move 12

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| no outpost (reference) | 374,390 | +0.0 ± 0.2 |  | -0.02 ± 0.05 (19,671) |
| 1 outpost square | 306,827 | +0.0 ± 0.2 | +0.0 ± 0.2 | +0.03 ± 0.06 (15,797) |
| 2 outpost squares | 87,873 | -0.2 ± 0.3 | -0.2 ± 0.4 | +0.04 ± 0.11 (4,596) |
| 3 or more | 14,874 | +0.2 ± 0.8 | +0.2 ± 0.8 | -0.35 ± 0.26 (736) |

## B. A knight already on an outpost at move 12

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| outposts exist, no knight on one (reference) | 399,513 | -0.1 ± 0.1 |  | +0.01 ± 0.05 (20,564) |
| knight on an outpost | 10,061 | +2.3 ± 0.9 | +2.4 ± 0.9 | +0.07 ± 0.30 (565) |

## C. Getting a knight there: outposts exist at move 12 but no knight on one yet; where is it by move 20?

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| no knight on an outpost at move 20 (reference) | 380,292 | -0.3 ± 0.2 |  | -0.02 ± 0.05 (19,509) |
| knight on an outpost at move 20 | 19,221 | +4.9 ± 0.7 | +5.2 ± 0.7 | +0.55 ± 0.22 (1,055) |

## D. Bishop pair

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| equal bishops (reference) | 608,248 | +0.0 ± 0.1 |  | +0.00 ± 0.04 (31,248) |
| I have the pair, they do not | 87,858 | +2.3 ± 0.3 | +2.3 ± 0.3 | -0.01 ± 0.11 (4,776) |
| they have the pair, I do not | 87,858 | -2.3 ± 0.3 | -2.3 ± 0.3 | +0.01 ± 0.11 (4,776) |

## E. Rooks on open or half-open files

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| level (reference) | 568,852 | +0.0 ± 0.1 |  | +0.00 ± 0.04 (29,766) |
| I have more rooks on open files than they | 107,556 | +0.1 ± 0.3 | +0.1 ± 0.3 | +0.07 ± 0.10 (5,517) |
| they have more | 107,556 | -0.1 ± 0.3 | -0.1 ± 0.3 | -0.07 ± 0.10 (5,517) |

Getting a rook there: I have a file that is open for me at move 12 but no rook on it yet.

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| still no rook on an open file at move 20 (reference) | 168,056 | -1.0 ± 0.2 |  | -0.20 ± 0.08 (8,696) |
| rook on an open or half-open file by move 20 | 211,689 | +0.6 ± 0.2 | +1.6 ± 0.3 | +0.10 ± 0.07 (11,083) |

## F. Piece mobility (safe squares for knights, bishops, rooks, queen) minus the enemy's, in four equal groups

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| 1 least mobile (≤ -5) (reference) | 227,668 | -1.7 ± 0.2 |  | +0.15 ± 0.07 (11,782) |
| 2 (≤ 0) | 182,953 | -0.5 ± 0.2 | +1.2 ± 0.3 | -0.02 ± 0.07 (9,598) |
| 3 (≤ 5) | 178,916 | +0.7 ± 0.2 | +2.4 ± 0.3 | +0.01 ± 0.07 (9,283) |
| 4 most mobile (> 5) | 194,427 | +1.8 ± 0.2 | +3.5 ± 0.3 | -0.16 ± 0.07 (10,137) |

## G. Space (total pawn advance) minus the enemy's, in four equal groups

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| 1 least space (≤ -2) (reference) | 237,205 | -0.8 ± 0.2 |  | +0.15 ± 0.07 (12,460) |
| 2 (≤ 0) | 208,548 | -0.1 ± 0.2 | +0.7 ± 0.3 | +0.03 ± 0.07 (10,700) |
| 3 (≤ 2) | 185,401 | +0.3 ± 0.2 | +1.1 ± 0.3 | -0.08 ± 0.07 (9,567) |
| 4 most space (> 2) | 152,810 | +1.0 ± 0.2 | +1.9 ± 0.3 | -0.17 ± 0.08 (8,073) |

## H. A bad bishop (own pawns on its colour; worst bishop)

| Group | Positions | Result | vs reference | Engine |
|---|---|---|---|---|
| good bishops, 3 or fewer pawns on its colour (reference) | 107,623 | -1.2 ± 0.3 |  | -0.05 ± 0.10 (5,720) |
| bad bishop, 4 or 5 | 583,843 | +0.1 ± 0.1 | +1.3 ± 0.3 | +0.03 ± 0.04 (30,266) |
| very bad bishop, 6 or more | 92,498 | +0.5 ± 0.3 | +1.7 ± 0.4 | -0.10 ± 0.10 (4,814) |

## I. All together: what matters once the others are held fixed?

A linear fit of the result (against rating expectation) on all eight features, each scaled to one standard deviation. The number is how many points of result one standard deviation of that feature is worth.

| Feature | Points per 1 SD | ± 95% |
|---|---|---|
| mobility diff | +1.36 | 0.12 |
| bishop pair (me minus them) | +1.11 | 0.12 |
| knight on outpost | +0.34 | 0.11 |
| their bad bishop | -0.08 | 0.12 |
| my bad bishop | +0.07 | 0.12 |
| space diff | +0.07 | 0.12 |
| outposts available | +0.04 | 0.11 |
| rooks on open files diff | +0.01 | 0.11 |

## Reading this honestly

- These are positions at move 12, a point where many outposts and files do not exist yet. Most positions have no outpost at all.
- Mobility and space are crude counts. They tend to move together with who is better.
- The "getting there" tests look at move 20, so players who got there may have been better already.
