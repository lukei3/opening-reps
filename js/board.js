// A small board: tap-tap or drag to move, last-move highlight, arrows, auto-flip.
import { settings } from './store.js';

const FILES = 'abcdefgh';
export const pieceSrc = (pc) => `pieces/${'cburnett'}/${pc}.svg`;

export class Board {
  /**
   * @param {HTMLElement} el   container (must be square via CSS)
   * @param {object} opts      { getTargets(from) => [to squares], onMove(from, to) }
   */
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.orientation = 'w';
    this.pieces = {};      // square -> 'wK' etc
    this.lastMove = null;
    this.enabled = false;
    this.userColor = 'w';
    this.selected = null;
    this.targets = [];
    this.arrows = [];
    this.check = null;
    this.drag = null;
    this.canMove = true;     // false while the opponent is to move: you may pick a piece up, but nothing is played
    this.premoveOn = !!opts.premove;   // with this on, a move made while canMove is false is queued as a premove
    this.premoves = [];                // queued moves [{from, to}], played in order once it is your turn
    el.classList.add('board');
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.premoves.length) this.clearPremoves(); });
    // a drag must never be left hanging: if the page misses the mouse button being released, the dragged piece would
    // otherwise stay stuck to the cursor. These end it however the drag was interrupted.
    window.addEventListener('pointercancel', () => this.cancelDrag());
    window.addEventListener('blur', () => this.cancelDrag());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelDrag(); });
    this.marks = { arrows: [], circles: [] };   // the user's own annotations (right-click)
    this.rc = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMoveEvt(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    this.render();
  }

  /** `keep`: the position moved on (the opponent played) but the piece you are holding should stay held. */
  set({ pieces, orientation, lastMove, check }, keep = false) {
    const prev = this.pieces, prevOrientation = this.orientation;
    if (pieces) this.pieces = pieces;
    if (orientation) this.orientation = orientation;
    this.lastMove = lastMove || null;
    this.check = check || null;
    const held = keep && this.selected && this.pieces[this.selected] && this.pieces[this.selected][0] === this.userColor;
    if (held) {
      this.targets = this.opts.getTargets(this.selected);   // now the opponent has moved, show where it can go
    } else {
      this.selected = null; this.targets = [];
      if (this.drag) { if (this.drag.ghost) this.drag.ghost.remove(); this.drag = null; }
    }
    this.marks = { arrows: [], circles: [] };
    this.render();
    const skip = this._skipAnim; this._skipAnim = false;
    if (!skip && this.orientation === prevOrientation) this.animateDiff(prev, this.pieces);
  }

  /**
   * Slide the pieces that moved (castling moves two, a pawn promoting arrives as a queen) and fade out anything captured.
   * Skipped for a move you just dragged (it is already where you dropped it), for a flip, and for big jumps like a new game.
   */
  animateDiff(prev, next) {
    if (settings().animations === false) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const changed = Object.keys(this.cells).filter((sq) => prev[sq] !== next[sq]);
    if (!changed.length || changed.length > 4) return;
    const dests = changed.filter((sq) => next[sq]);
    const lost = changed.filter((sq) => prev[sq]);
    const used = new Set();
    for (const d of dests) {
      const piece = next[d];
      let src = lost.find((s) => s !== d && !used.has(s) && prev[s] === piece);
      if (!src) src = lost.find((s) => !used.has(s) && prev[s] && prev[s][0] === piece[0] && prev[s][1] === 'P');   // promotion
      if (!src) continue;
      used.add(src);
      this.slide(src, d);
    }
    for (const s of lost) if (!used.has(s)) this.fadeOut(s, prev[s]);
  }

  slide(from, to) {
    const cell = this.cells[to];
    if (!cell.img) return;
    const a = this.cells[from].el.getBoundingClientRect(), b = cell.el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    cell.el.style.zIndex = '6';
    const anim = cell.img.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 150, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)' });
    anim.onfinish = anim.oncancel = () => { cell.el.style.zIndex = ''; };
  }

  fadeOut(sq, piece) {
    const cell = this.cells[sq];
    const ghost = document.createElement('img');
    ghost.src = pieceSrc(piece); ghost.alt = ''; ghost.className = 'ghostfade';
    cell.el.appendChild(ghost);
    const anim = ghost.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.72)' }],
      { duration: 140, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = anim.oncancel = () => ghost.remove();
  }

  // Right-click: press on one square, release on another for an arrow, or on the same square for a circle.
  // Orange by default, like chess.com. Shift = green, Ctrl = red, Alt = blue. Drawing the same thing again removes it.
  markColor(e) { return e.shiftKey ? '#15781b' : e.ctrlKey ? '#c0392b' : e.altKey ? '#1f6fd1' : '#f7a928'; }

  endMark(e) {
    const rc = this.rc; this.rc = null;
    if (!rc) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    const toggle = (list, same) => {
      const i = list.findIndex(same);
      if (i >= 0) { const old = list.splice(i, 1)[0]; return old.color !== rc.color; } // same colour: remove; else recolour
      return true;
    };
    if (sq === rc.from) {
      const item = { sq, color: rc.color };
      if (toggle(this.marks.circles, (c) => c.sq === sq)) this.marks.circles.push(item);
    } else {
      const item = { from: rc.from, to: sq, color: rc.color };
      if (toggle(this.marks.arrows, (a) => a.from === rc.from && a.to === sq)) this.marks.arrows.push(item);
    }
    this.render();
  }

  /** Turning input on while it is already on (your turn arriving) keeps whatever piece you are holding. */
  setEnabled(on, userColor) {
    const was = this.enabled;
    this.enabled = on;
    this.canMove = true;
    if (userColor) this.userColor = userColor;
    if (!on || !was) {
      this.selected = null; this.targets = [];
      if (this.drag) { if (this.drag.ghost) this.drag.ghost.remove(); this.drag = null; }
    }
    this.render();
  }
  setArrows(arrows) { this.arrows = arrows || []; this.render(); }

  /** Arrows and highlighted squares that belong to the position being shown (a study's own drawings). null clears them. */
  setShapes(shapes) {
    this.shapeArrows = (shapes && shapes.arrows) || [];
    this.shapeCircles = (shapes && shapes.circles) || [];
    this.render();
  }

  // ---- premoves (chess.com style): queue moves while the opponent is to move; right-click, Escape or a tap on a queued square cancels them ----

  /** The pieces as they will stand once every queued premove has been played. */
  virtualPieces() {
    const v = { ...this.pieces };
    for (const pm of this.premoves) {
      const pc = v[pm.from];
      if (!pc) continue;
      delete v[pm.from]; v[pm.to] = pc;
    }
    return v;
  }

  /** Where a piece could go if nothing else changed: its own way of moving, blocked by pieces, ignoring checks. */
  pseudoTargets(from, pcs) {
    const pc = pcs[from];
    if (!pc) return [];
    const col = pc[0], kind = pc[1];
    const f0 = FILES.indexOf(from[0]), r0 = parseInt(from[1], 10);
    const out = [];
    const at = (f, r) => (f >= 0 && f < 8 && r >= 1 && r <= 8 ? FILES[f] + r : null);
    const add = (sq, captureOnly = false) => {
      if (!sq) return false;
      const o = pcs[sq];
      if (o && o[0] === col) return false;
      if (captureOnly && !o) return false;
      out.push(sq);
      return !o;                      // a sliding piece goes on only through empty squares
    };
    const slide = (dirs) => { for (const [df, dr] of dirs) { let f = f0 + df, r = r0 + dr; while (add(at(f, r))) { f += df; r += dr; } } };
    if (kind === 'N') {
      for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(at(f0 + df, r0 + dr));
    } else if (kind === 'K') {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { if (df || dr) add(at(f0 + df, r0 + dr)); }
    } else if (kind === 'R') {
      slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    } else if (kind === 'B') {
      slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    } else if (kind === 'Q') {
      slide([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
    } else if (kind === 'P') {
      const dir = col === 'w' ? 1 : -1;
      const one = at(f0, r0 + dir);
      if (one && !pcs[one]) {
        out.push(one);
        const two = at(f0, r0 + 2 * dir);
        if ((col === 'w' ? r0 === 2 : r0 === 7) && two && !pcs[two]) out.push(two);
      }
      for (const df of [-1, 1]) { const d = at(f0 + df, r0 + dir); if (d && !(pcs[d] && pcs[d][0] === col)) out.push(d); }
    }
    return out;
  }

  /**
   * Chess.com's promotion picker: a column of Queen, Knight, Rook and Bishop opens on the square the pawn is going to,
   * growing toward the middle of the board. Click one (or press Q, N, R or B) to choose; click elsewhere or press Escape
   * to cancel. Resolves to 'q' | 'n' | 'r' | 'b', or null when cancelled.
   */
  promptPromotion(to, color) {
    return new Promise((resolve) => {
      this.promoting = true;
      const [x, y] = this.xy(to);                 // the square's centre in board units (0..8)
      const down = y < 4;                         // a square on the top half: the column grows downward
      const order = down ? ['q', 'n', 'r', 'b'] : ['b', 'r', 'n', 'q'];   // the queen is always on the edge square
      const back = document.createElement('div'); back.className = 'promoback';
      const col = document.createElement('div'); col.className = 'promopick';
      col.style.left = `${(x - 0.5) * 12.5}%`;
      col.style.top = `${(down ? y - 0.5 : y + 0.5 - 4) * 12.5}%`;
      const done = (v) => {
        window.removeEventListener('keydown', onKey, true);
        back.remove(); col.remove();
        this.promoting = false;
        this.render();
        resolve(v);
      };
      const onKey = (e) => {
        const k = e.key.toLowerCase();
        if (k === 'escape') { e.preventDefault(); done(null); }
        else if ('qnrb'.includes(k) && k.length === 1) { e.preventDefault(); done(k); }
      };
      for (const p of order) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.piece = p;
        b.setAttribute('aria-label', { q: 'Queen', n: 'Knight', r: 'Rook', b: 'Bishop' }[p]);
        const img = document.createElement('img'); img.src = pieceSrc(color + p.toUpperCase()); img.alt = '';
        b.appendChild(img);
        b.onclick = (e) => { e.stopPropagation(); done(p); };
        col.appendChild(b);
      }
      back.onclick = () => done(null);
      back.addEventListener('contextmenu', (e) => { e.preventDefault(); done(null); });
      window.addEventListener('keydown', onKey, true);
      this.el.append(back, col);
    });
  }

  addPremove(from, to) { this.premoves.push({ from, to }); this.render(); }
  shiftPremove() { const pm = this.premoves.shift(); this.render(); return pm; }
  clearPremoves() { if (!this.premoves.length) return; this.premoves = []; this.selected = null; this.targets = []; this.render(); }

  sqAt(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8);
    const y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  xy(sq) { // centre of a square in 0..8 board units
    const f = FILES.indexOf(sq[0]), r = parseInt(sq[1], 10);
    return this.orientation === 'w' ? [f + 0.5, 8 - r + 0.5] : [7 - f + 0.5, r - 0.5];
  }

  onDown(e) {
    if (this.promoting) return;     // the promotion picker is open: only it takes input
    if (e.button === 2) {
      if (this.premoves.length) { this.clearPremoves(); e.preventDefault(); return; }   // right-click cancels premoves, as on chess.com
      const from = this.sqAt(e.clientX, e.clientY);
      if (from) this.rc = { from, color: this.markColor(e) };
      e.preventDefault();
      return;
    }
    if (this.marks.arrows.length || this.marks.circles.length) { this.marks = { arrows: [], circles: [] }; this.render(); }
    if (!this.enabled) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    const premoving = this.premoveOn && !this.canMove;
    const pcs = this.premoves.length ? this.virtualPieces() : this.pieces;
    const pc = pcs[sq];
    if ((this.canMove || premoving) && this.selected && this.targets.includes(sq)) { this.finish(this.selected, sq); e.preventDefault(); return; }
    if (premoving && !this.selected && this.premoves.some((p) => p.from === sq || p.to === sq)) { this.clearPremoves(); e.preventDefault(); return; }
    if (pc && pc[0] === this.userColor) {
      this.selected = sq;
      this.targets = premoving ? this.pseudoTargets(sq, pcs) : this.opts.getTargets(sq);
      this.drag = { from: sq, moved: false, x: e.clientX, y: e.clientY, pc };
      this.render();
      e.preventDefault();
    } else {
      this.selected = null; this.targets = []; this.render();
    }
  }

  /** Drop whatever is being dragged: the dragged image goes, and the piece is shown on its square again. */
  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    this.render();
  }

  onMoveEvt(e) {
    if (!this.drag) return;
    if (e.buttons === 0) { this.cancelDrag(); return; }     // the button was released somewhere we did not see
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    if (!d.ghost) {
      document.querySelectorAll('.dragghost').forEach((g) => g.remove());   // never more than one dragged image on the page
      d.ghost = document.createElement('img');
      d.ghost.draggable = false;
      d.ghost.src = pieceSrc(d.pc);
      d.ghost.className = 'dragghost';
      const w = this.el.getBoundingClientRect().width / 8;
      d.ghost.style.width = d.ghost.style.height = w + 'px';
      document.body.appendChild(d.ghost);
      this.render();
    }
    const w = parseFloat(d.ghost.style.width);
    d.ghost.style.left = e.clientX - w / 2 + 'px';
    d.ghost.style.top = e.clientY - w / 2 + 'px';
  }

  onUp(e) {
    if (e.button === 2) { this.endMark(e); return; }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    if (d.moved) {
      const sq = this.sqAt(e.clientX, e.clientY);
      if ((this.canMove || this.premoveOn) && sq && this.targets.includes(sq)) { this.finish(d.from, sq, true); return; }
      if (this.canMove || this.premoveOn) { this.selected = null; this.targets = []; }   // otherwise keep holding it until the opponent has moved
    }
    this.render();
  }

  finish(from, to, dragged = false) {
    this._skipAnim = dragged;   // a dragged piece is already at its destination; a tap-tap move should slide
    this.selected = null; this.targets = [];
    if (this.canMove) this.opts.onMove(from, to);
    else this.addPremove(from, to);   // the opponent is to move: queue it
  }

  /**
   * The 64 squares are built once and then only changed where something differs, so pieces never blink
   * out while images reload (the old version rebuilt every square on every update).
   */
  build() {
    this.el.innerHTML = '';
    this.cells = {};
    for (const f of FILES) {
      for (let r = 1; r <= 8; r++) {
        const sq = f + r;
        const el = document.createElement('div');
        el.dataset.sq = sq;
        const cf = document.createElement('i'); cf.className = 'cf';
        const cr = document.createElement('i'); cr.className = 'cr';
        el.append(cf, cr);
        this.cells[sq] = { el, cf, cr, cls: '', pc: null, src: '', img: null, dot: null };
      }
    }
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.layoutFor = null;
    // Decode every piece image up front so none appears late.
    this.preloaded = null;
  }

  preload() {
    const set = 'cburnett';
    if (this.preloaded === set) return;
    this.preloaded = set;
    for (const c of 'wb') for (const p of 'KQRBNP') { const i = new Image(); i.src = pieceSrc(c + p); i.decode && i.decode().catch(() => {}); }
  }

  layout() {
    const o = this.orientation;
    if (this.layoutFor === o) return;
    this.layoutFor = o;
    this.el.textContent = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = o === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
        const c = this.cells[sq];
        c.cf.textContent = row === 7 ? sq[0] : '';
        c.cr.textContent = col === 0 ? sq[1] : '';
        this.el.appendChild(c.el);
      }
    }
    this.el.appendChild(this.svg);
  }

  render() {
    if (!this.cells) this.build();
    this.preload();
    this.layout();
    const shown = this.premoves.length ? this.virtualPieces() : this.pieces;   // queued premoves are drawn as if already played
    const pmSquares = new Set(this.premoves.flatMap((p) => [p.from, p.to]));
    for (const sq in this.cells) {
      const c = this.cells[sq];
      const light = (FILES.indexOf(sq[0]) + parseInt(sq[1], 10)) % 2 === 0; // a1 is a dark square
      let cls = 'sq ' + (light ? 'l' : 'd');
      if (this.lastMove && (sq === this.lastMove[0] || sq === this.lastMove[1])) cls += ' last';
      if (sq === this.selected) cls += ' sel';
      if (sq === this.check) cls += ' check';
      if (pmSquares.has(sq)) cls += ' pm';
      if (c.cls !== cls) { c.el.className = cls; c.cls = cls; }

      const pc = shown[sq];
      const hidden = this.drag && this.drag.ghost && this.drag.from === sq;
      const want = pc && !hidden ? pc : null;
      const src = want ? pieceSrc(want) : '';
      if (c.src !== src) {
        if (c.img && src) c.img.src = src;                       // same square, different piece: reuse the element
        else if (c.img) { c.img.remove(); c.img = null; }
        else if (src) { c.img = document.createElement('img'); c.img.draggable = false; c.img.alt = ''; c.img.src = src; c.el.appendChild(c.img); }
        c.src = src; c.pc = want;
      }

      const wantDot = this.targets.includes(sq) ? (pc ? 'dot cap' : 'dot') : '';
      if ((c.dot ? c.dot.className : '') !== wantDot) {
        if (c.dot) { c.dot.remove(); c.dot = null; }
        if (wantDot) { c.dot = document.createElement('b'); c.dot.className = wantDot; c.el.appendChild(c.dot); }
      }
    }
    this.svg.innerHTML = this.arrowsSvg();
  }

  arrowsSvg() {
    const premoveArrows = this.premoves.map((p) => ({ from: p.from, to: p.to, color: '#d63e32', opacity: 0.55, width: 0.14 }));
    const all = [...(this.shapeArrows || []), ...this.arrows, ...this.marks.arrows, ...premoveArrows];
    const circles = [...(this.shapeCircles || []), ...this.marks.circles].map((c) => {
      const [x, y] = this.xy(c.sq);
      return `<circle cx="${x}" cy="${y}" r="0.44" fill="none" stroke="${c.color}" stroke-width="0.11" opacity="0.7"/>`;
    });
    if (!all.length && !circles.length) return '';
    const parts = all.map((a) => {
      const [x1, y1] = this.xy(a.from), [x2, y2] = this.xy(a.to);
      const w = a.width ?? 0.18, h = w / 2;
      const knight = settings().knightArrows !== 'straight' &&
        ((Math.abs(x2 - x1) === 1 && Math.abs(y2 - y1) === 2) || (Math.abs(x2 - x1) === 2 && Math.abs(y2 - y1) === 1));
      // Knight moves are drawn as an L: two squares along the long side, then one across (not a diagonal).
      const corner = knight ? (Math.abs(x2 - x1) > Math.abs(y2 - y1) ? [x2, y1] : [x1, y2]) : null;
      const [lx, ly] = corner || [x1, y1];                       // start of the final leg
      const dx = x2 - lx, dy = y2 - ly, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // Big, wide heads and a firm shaft: the proportions of the Lichess analysis arrows.
      const headLen = Math.min(Math.max(0.3, 2.4 * w), len * 0.85), headHalf = Math.max(0.2, 1.6 * w);
      const ex = x2 - ux * headLen, ey = y2 - uy * headLen;       // where the head begins
      // The whole arrow is ONE filled outline (shaft rectangles plus the head triangle), so there are no seams at the
      // joins and overlapping parts never darken each other.
      const rect = (ax, ay, bx, by) => {
        const d = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / d) * h, ny = ((bx - ax) / d) * h;
        return `M${ax + nx},${ay + ny}L${bx + nx},${by + ny}L${bx - nx},${by - ny}L${ax - nx},${ay - ny}Z`;
      };
      let d;
      if (corner) {
        const [cx, cy] = corner;
        const u1x = Math.sign(cx - x1), u1y = Math.sign(cy - y1);   // first leg runs along one axis
        d = rect(x1, y1, cx + u1x * h, cy + u1y * h) + rect(cx - ux * h, cy - uy * h, ex, ey);
      } else {
        d = rect(x1, y1, ex, ey);
      }
      const px = -uy * headHalf, py = ux * headHalf;
      d += `M${x2},${y2}L${ex + px},${ey + py}L${ex - px},${ey - py}Z`;
      return `<path d="${d}" fill="${a.color}" opacity="${a.opacity ?? 0.8}"/>`;
    });
    return circles.join('') + parts.join('');
  }
}

