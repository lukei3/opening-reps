# Training data for the idea namer

Everything is converted to one format by `tools/plans/build_corpus.py` (and `tools/plans/books_to_corpus.py` for the books):
one JSON line per (position, move) with idea labels from a shared vocabulary, the original comment if there is one, and a
`trust` field saying where the labels came from. The large files stay on this computer (not in git); only this note and the
small STS file are committed.

| Source | Licence | What it is | Trust |
|---|---|---|---|
| [Strategic Test Suite](https://github.com/fsmosca/STS-Rating) | MIT | 1,500 positions, 15 strategic themes, best move and scored alternatives | expert |
| [Positional puzzles](https://github.com/neilgd/chess-position-analysis-results) | MIT (credit asked) | 2,204 Lichess positions reviewed and categorised by WIM/FM Liwia Jarocka, WGM Michalina Rudzińska and WGM Margarita Voyska | expert |
| Capablanca, *Chess Fundamentals* (1921), [Gutenberg 33870](https://www.gutenberg.org/ebooks/33870) | Public domain (US) | Annotated games, descriptive notation converted to moves | expert-comment |
| E. Lasker, *Chess Strategy* (1915), [Gutenberg 5614](https://www.gutenberg.org/ebooks/5614) | Public domain (US) | Annotated games and diagram positions | expert-comment |
| Lichess studies | Owned by their authors; used locally for training only, not published | 196 public studies from the popular list and the Middlegame, Strategy, Positional and Endgame topic pages | comment |
| [ChessGPT annotated PGN](https://huggingface.co/datasets/Waterhorse/chess_data) | Apache 2.0 | Annotated games from Lichess studies, GameKnot and other sources | comment |
| [MATE strategy](https://huggingface.co/datasets/OutFlankShu/MATE_DATASET) | MIT | Candidate-move pairs with strategy explanations. The explanations are about 20 fixed phrasings per category (65% are "piece activity"), so they are treated as rule-made, not expert | rules |
| [Lichess puzzles](https://huggingface.co/datasets/Lichess/chess-puzzles) | CC0 | Puzzle theme tags, mostly tactical | crowd |

Not used: [pilipolio/chess-positions-concepts](https://huggingface.co/datasets/pilipolio/chess-positions-concepts) (labelled by
GPT-4.1-mini, not by people).

Labels from comments are read from the words ("outpost", "open file", "minority attack", ...), so they are noisy: a comment can
mention an idea that the move does not serve.
