# Engine-grounded idea labels: do they agree with people?

109,033 engine lines measured with Stockfish 11's evaluation parts. A move's engine ideas are the parts that improved most over its eight-ply line (at least one standard deviation more than moves usually manage).

| Source | Labelled moves | Engine gave an idea | Agrees with the human label | Chance agreement |
|---|---|---|---|---|
| book-capablanca | 154 | 53% | **20%** | 16% |
| book-lasker | 49 | 71% | **0%** | 0% |
| chessgpt-annotated | 6,754 | 71% | **18%** | 12% |
| lichess-studies | 2,128 | 68% | **22%** | 13% |
| positional-puzzles | 1,708 | 77% | **24%** | 23% |
| sts | 1,188 | 75% | **14%** | 7% |
| wikibooks | 948 | 74% | **24%** | 21% |

## How often each evaluation part is a move's main change

| Part | Lines where it changed most |
|---|---|
| Rooks | 9,842 |
| Bishops | 8,304 |
| Threats | 8,115 |
| Knights | 7,981 |
| Space | 7,219 |
| Mobility | 7,081 |
| Pawns | 6,389 |
| Initiative | 5,025 |
| Imbalance | 4,346 |
| Material | 4,068 |
| Passed | 3,920 |
| King safety:opp | 3,670 |
| King safety:own | 2,928 |

Agreement means at least one of the engine's ideas matches at least one human label for the same move. Chance is the same check with the human labels shuffled between moves.
