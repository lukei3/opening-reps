# Weak pawns as targets (King's Indian)

783,964 side-positions (every game that reaches move 25, both sides). A "target" is an enemy pawn at move 12 that is isolated, backward (cannot advance because a pawn controls the square ahead) or the rear pawn of a doubled pair.

Columns: **Result** = score against what the rating gap predicts, in points (95% margin). **vs none** = difference from positions where the enemy has no weak pawn. **Wins a pawn** = the side won more pawns than it lost between move 12 and 25. **Loses a pawn** = the reverse. **Engine** = Stockfish evaluation change, in pawns.

| Group | Positions | Result | vs none | Wins a pawn | Loses a pawn | Engine |
|---|---|---|---|---|---|---|
| **A. Does the enemy have a weak pawn?** | | | | | | |
| no weak pawn | 622,678 | -0.2 ± 0.1 |  | 28% | 30% | +0.02 ± 0.04 (32,247) |
| 1 weak pawn | 143,648 | +0.6 ± 0.2 | +0.8 ± 0.3 | 33% | 27% | -0.05 ± 0.08 (7,668) |
| 2 or more weak pawns | 17,638 | +0.9 ± 0.7 | +1.1 ± 0.7 | 40% | 25% | -0.18 ± 0.25 (885) |
| **B. Which kind** | | | | | | |
| isolated pawn present | 44,034 | +1.1 ± 0.4 | +1.3 ± 0.5 | 36% | 28% | -0.00 ± 0.16 (2,331) |
| backward pawn present | 111,131 | +0.6 ± 0.3 | +0.8 ± 0.3 | 31% | 28% | -0.09 ± 0.09 (5,897) |
| doubled pawn present | 25,342 | +0.1 ± 0.6 | +0.2 ± 0.6 | 52% | 19% | -0.10 ± 0.21 (1,279) |
| **C. How much pressure on the best target at move 12** (my attackers minus their defenders) | | | | | | |
| well defended (-2 or worse) | 22,702 | -0.7 ± 0.6 | -0.5 ± 0.6 | 33% | 27% | +0.07 ± 0.21 (1,201) |
| slightly defended (-1 to 0) | 127,513 | +0.7 ± 0.3 | +0.9 ± 0.3 | 33% | 27% | -0.10 ± 0.09 (6,770) |
| under pressure (+1 or more) | 11,071 | +2.4 ± 0.9 | +2.5 ± 0.9 | 46% | 25% | +0.03 ± 0.33 (582) |
| **D. File access** | | | | | | |
| target on a file open to my rooks (no pawn of mine on it) | 48,014 | +0.6 ± 0.4 | +0.8 ± 0.4 | 42% | 25% | +0.07 ± 0.15 (2,533) |
| target on a file blocked by my own pawn | 113,272 | +0.6 ± 0.3 | +0.8 ± 0.3 | 30% | 28% | -0.12 ± 0.09 (6,020) |
| **E. Did the side build up on the target by move 20?** (target still there; my attackers then minus at move 12) | | | | | | |
| built up (+1 attacker or more) | 21,550 | +2.3 ± 0.6 | +2.4 ± 0.6 | 35% | 26% | +0.27 ± 0.22 (1,149) |
| no build-up (0 or fewer) | 87,525 | -0.4 ± 0.3 | -0.3 ± 0.3 | 27% | 30% | -0.22 ± 0.10 (4,714) |
| target already gone by move 20 (moved, traded or captured) | 52,211 | +1.8 ± 0.4 | +1.9 ± 0.4 | 44% | 23% | +0.06 ± 0.15 (2,690) |
| **F. Textbook: isolated or backward target, file open, already under pressure** | | | | | | |
| all three | 6,367 | +2.2 ± 1.2 | +2.4 ± 1.2 | 45% | 27% | +0.14 ± 0.45 (324) |

## Reading this honestly

- Having a target at move 12 is not a choice. Compare with the "none" row, but stronger players also reach better structures.
- "Wins a pawn" counts net pawns, so a pawn won back and a trade of pawns cancel.
- Build-up is measured at move 20, after the plan has been underway for eight moves. Players who build up may be those who are already better.
- Attackers are all pieces and pawns that can capture on the square, not only pieces.
