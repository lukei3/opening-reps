# Recurring plans found without labels

109,033 engine lines grouped into 24 kinds by what they change (Stockfish 11 evaluation parts) and what the side does (which pieces move, where, pawn moves by wing, trades). "Improves" and "gives up" are the evaluation parts that rise or fall most in that group; "people called it" lists the human labels on moves in the group, where there are any.

| Group | Lines | Improves | Gives up | Typical moves | People called it |
|---|---|---|---|---|---|
| 14 | 7,426 | Knights | Rooks | Nd7 Nf6 Nh5 Nc5 Ne5 Ne4 | development, exchange, sacrifice, initiative |
| 10 | 6,297 | Space, Initiative, Mobility | Rooks | Pe5 Pd5 Pe6 Pe4 Pd4 Pd6 | development, space, exchange, sacrifice |
| 8 | 6,153 | King safety:opp | King safety:own | Pf5 Pg4 Pg5 Pf4 Ph5 Ph4 | development, space, initiative, exchange |
| 1 | 6,129 | Rooks | - | Rd1 Re1 Re8 Rc1 Rd8 Rc8 | development, coordination, exchange, restriction |
| 3 | 6,056 | - | - | Be3 Bg5 Bd7 Be2 Bd3 Bd2 | development, exchange, space, restriction |
| 7 | 6,042 | - | - | Pa5 Pa4 Pb4 Pc5 Pb6 Pb5 | development, exchange, restriction, space |
| 6 | 6,029 | - | King safety:opp, Rooks | Qb6 Qd2 Qc2 Qe7 Qb3 Qc7 | exchange, development, sacrifice, coordination |
| 16 | 5,675 | Mobility | - | Ph6 Pf5 Pa5 Ph3 Ph5 Pb6 | development, restriction, space, exchange |
| 18 | 5,312 | - | - | Kg7 Kh8 Kh1 Kh7 Kg2 Kf1 | endgame_technique, exchange, weakness, sacrifice |
| 12 | 5,011 | Passed | - | Pb5 Pb4 Pc5 Pa5 Pa4 Pc6 | development, exchange, space, weakness |
| 5 | 4,922 | Bishops | Imbalance, Mobility | Bf6 Bf3 Bg4 Bg5 Bf5 Bh6 | exchange, development, sacrifice, weakness |
| 21 | 4,657 | - | Space, Mobility | Pe5 Pd5 Pe6 Pd6 Pe4 Pd4 | development, exchange, space, sacrifice |
| 4 | 4,395 | Rooks, Mobility, Material | Knights, Bishops | Kg1 Kg8 Kc1 Pd5 Be2 Qd2 | development, exchange, space, sacrifice |
| 20 | 4,360 | Rooks, Mobility | - | Rd1 Rd8 Re1 Re8 Ne4 Qd2 | exchange, development, endgame_technique, open_file |
| 9 | 4,353 | Space, Imbalance, Pawns | Bishops, Rooks | Ne4 Ne5 Nd5 Nd4 Pd5 Nc5 | exchange, development, sacrifice, weakness |
| 23 | 4,125 | Imbalance | - | Rc1 Rc8 Rb1 Rb8 Rc7 Rc2 | exchange, endgame_technique, seventh_rank, open_file |
| 2 | 3,736 | Material, Imbalance, Initiative | Threats, Bishops | Pe5 Pd5 Pf5 Pc5 Pf3 Bf3 | exchange, weakness, development, sacrifice |
| 11 | 3,427 | Threats, Bishops, Knights | Material, Imbalance | Rd1 Re1 Rc1 Qd2 Pf5 Nd7 | development, exchange, sacrifice, weakness |
| 13 | 3,240 | Rooks | Initiative, Space | Kg1 Kc1 Be2 Pd5 Kg8 Bd3 | development, exchange, sacrifice, space |
| 15 | 2,811 | Pawns | Passed, Imbalance | Pc5 Pb5 Rc8 Nf6 Pe5 Re8 | exchange, endgame_technique, development, sacrifice |
| 22 | 2,349 | Threats, Pawns, Knights | Material, Imbalance | Ne4 Ne5 Nd5 Pe5 Pd5 Pf5 | sacrifice, development, exchange, restriction |
| 19 | 2,334 | King safety:opp, Mobility | - | Qh4 Pf5 Ne4 Ng5 Nh5 Nf4 | exchange, sacrifice, development, initiative |
| 17 | 2,152 | - | King safety:own, Mobility | Pf5 Pg4 Ph5 Pf4 Re8 Re1 | development, exchange, sacrifice, weakness |
| 0 | 2,042 | King safety:own, Mobility, Rooks | King safety:opp | Kh8 Qf6 Rf8 Qd2 Rd1 Kg7 | exchange, endgame_technique, sacrifice, development |
