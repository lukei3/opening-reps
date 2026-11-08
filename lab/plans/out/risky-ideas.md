# Which ideas go wrong most often?

30,000 real mistakes (Lichess engine evaluation dropped 1.5 pawns or more; players 1500 to 2500, every opening, 2024) and 30,000 good engine moves from the same months, each named by the idea namer. "Risk" is how much more common the idea is among mistakes than among good moves (1.0 = no difference), with a 95% range.

| Idea | Among mistakes | Among good moves | Risk | 95% range |
|---|---|---|---|---|
| Endgame technique | 357 | 307 | **1.16x** | 1.0 to 1.35 |
| Restrict their pieces | 293 | 303 | **0.97x** | 0.82 to 1.14 |
| Keep the initiative | 99 | 105 | **0.94x** | 0.72 to 1.24 |
| Look after the king | 125 | 133 | **0.94x** | 0.74 to 1.2 |
| Fix their pawn structure | 80 | 87 | **0.92x** | 0.68 to 1.25 |
| Gain space | 433 | 515 | **0.84x** | 0.74 to 0.96 |
| Coordinate the pieces | 582 | 721 | **0.81x** | 0.72 to 0.9 |
| Trade pieces | 108 | 158 | **0.68x** | 0.54 to 0.87 |
| Prophylaxis: stop their idea first | 31 | 51 | **0.61x** | 0.39 to 0.95 |
| Develop a piece | 67 | 196 | **0.34x** | 0.26 to 0.45 |

The namer labels what a move tries to do; it does not know the move failed. A high risk means players who try that idea go badly wrong more often than players who try other ideas, so the app shows a warning next to it.
