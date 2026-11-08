# Idea namer: every version side by side

Expert columns are cross-validated on the Strategic Test Suite and the WGM-reviewed puzzles (positions the model did not train on). "Outside" is agreement with human comments it never saw (AUC: 0.5 is guessing, 1.0 perfect). The book table is the cleanest test: comments by Capablanca, Lasker, Staunton and others.

| Version | Expert: top idea | Expert: top three | Outside (AUC) |
|---|---|---|---|
| v2 experts only | 75% | 95% | 0.64 |
| v2 + comments | 71% | 92% | 0.72 |
| v3 same moves, no brain | 73% | 94% | 0.58 |
| v3 with Maia-2 + Stockfish | 72% | 93% | 0.6 |
| final, comments weight 0.3 | 63% | 88% | 0.59 |
| final, comments weight 0.08 (in use) | 74% | 94% | 0.56 |

## On the book comments, per idea (AUC, comments naming it)

| Book | Idea | v2 experts only | v2 + comments | v3 same moves, no brain | v3 with Maia-2 + Stockfish | final, comments weight 0.3 | final, comments weight 0.08 (in use) |
|---|---|---|---|---|---|---|---|
| book-capablanca | development (40) | 0.65 | 0.73 | 0.75 | 0.80 | 0.77 | 0.76 |
| book-capablanca | exchange (18) | 0.47 | 0.71 | 0.64 | 0.59 | 0.59 | 0.38 |
| book-capablanca | initiative (15) | - | - | 0.46 | 0.48 | 0.42 | 0.49 |
| book-lasker-common-sense | development (28) | - | - | 0.49 | 0.52 | 0.49 | 0.46 |
| book-mason-art | development (18) | - | - | 0.37 | 0.38 | 0.53 | 0.57 |
