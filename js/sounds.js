// Moves, captures and the finish chime are recorded impacts from Kenney's Impact Sounds (CC0, public domain).
// Mistakes are deliberately silent: the screen change is enough, and a buzz felt wrong.
import { settings, save } from './store.js';

const FILES = {
  move: 'sounds/impactWood_light_002.mp3',
  capture: 'sounds/impactWood_medium_001.mp3',
  check: 'sounds/impactWood_heavy_002.mp3',
  done: 'sounds/impactSoft_medium_000.mp3',
};
let ctx = null;
const buffers = {};

function audio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

async function load(name) {
  const c = audio(); if (!c) return null;
  if (!buffers[name]) {
    buffers[name] = fetch(FILES[name])
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
  }
  return buffers[name];
}

/** Fetch and decode every sound up front so the first move is not delayed. */
export function warmSounds() { for (const n of Object.keys(FILES)) load(n); }

export async function play(name) {
  if (settings().sound === false || !FILES[name]) return;
  const c = audio(); if (!c) return;
  const buf = await load(name);
  if (!buf) return;
  const src = c.createBufferSource(); src.buffer = buf;
  src.connect(c.destination); src.start();
}

export function setSound(on) { settings().sound = on; save(); }
export const soundOn = () => settings().sound !== false;

/** Which sound a move deserves. */
export function moveSound(mv, game) {
  if (game.isCheckmate() || game.inCheck()) return 'check';
  return mv.captured ? 'capture' : 'move';
}
