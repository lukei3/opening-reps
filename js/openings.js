// Openings are plain data: a side and the moves already played when the drill starts.
// To add an opening, add an entry here. Nothing else in the trainer changes.
//
// `restrict` (optional) lets the bot be limited to a sub-set of the opening, e.g. only the open Sicilian.
// It receives the SAN moves played so far and the bot's candidate SAN, and returns false to skip it.

const openSicilianOnly = (sans, cand) => {
  if (sans[0] !== 'e4' || sans[1] !== 'c5') return true;
  if (sans.length === 2) return cand === 'Nf3';
  if (sans.length === 4 && sans[2] === 'Nf3') return cand === 'd4';
  return true;
};

export const OPENINGS = [
  { id: 'start', group: 'Free play', name: 'Start position (no opening chosen)', side: 'w', moves: '' },
  { id: 'sicilian', group: 'Sicilian Defence (Black)', name: 'Sicilian: all lines', side: 'b', moves: 'e4 c5',
    restrict: openSicilianOnly, restrictLabel: 'Open Sicilian only (White plays Nf3 and d4)' },
  { id: 'sicilian-open', group: 'Sicilian Defence (Black)', name: 'Open Sicilian (after 3.d4 cxd4 4.Nxd4)', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4' },
  { id: 'najdorf', group: 'Sicilian Defence (Black)', name: 'Najdorf (…a6)', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6' },
  { id: 'dragon', group: 'Sicilian Defence (Black)', name: 'Dragon (…g6)', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6' },
  { id: 'scheveningen', group: 'Sicilian Defence (Black)', name: 'Scheveningen (…d6, …e6)', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6' },
  { id: 'sveshnikov', group: 'Sicilian Defence (Black)', name: 'Sveshnikov (…Nc6, …e5)', side: 'b', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5' },
  { id: 'taimanov', group: 'Sicilian Defence (Black)', name: 'Taimanov (…e6, …Nc6)', side: 'b', moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6' },
  { id: 'kan', group: 'Sicilian Defence (Black)', name: 'Kan (…e6, …a6)', side: 'b', moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6' },
  { id: 'french', group: 'Other (Black)', name: 'French Defence', side: 'b', moves: 'e4 e6' },
  { id: 'caro-kann', group: 'Other (Black)', name: 'Caro-Kann Defence', side: 'b', moves: 'e4 c6' },
  { id: 'italian', group: 'Other (White)', name: 'Italian Game', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bc4' },
  { id: 'ruy', group: 'Other (White)', name: 'Ruy Lopez', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bb5' },
  { id: 'london', group: 'Other (White)', name: 'London System', side: 'w', moves: 'd4 d5 Bf4' },
];

export const movesOf = (op) => op.moves.split(/\s+/).filter(Boolean);
export const byId = (id) => OPENINGS.find((o) => o.id === id) || OPENINGS[0];
