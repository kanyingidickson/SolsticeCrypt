/**
 * @module SolsticeCrypt
 * @description SOLSTICE CRYPT — Game Logic & Rendering Engine
 *
 * A real-time optical decryption puzzle game built with HTML5 Canvas,
 * Web Audio API, and Vanilla JS. Zero runtime dependencies.
 *
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────┐
 * │ Constants (COLOR, TYPE, DIR, color maps)         │
 * │ Direction helpers (rotate, compare)              │
 * │ SoundSynth class (procedural Web Audio synth)    │
 * │ LEVELS array (8 sectors of puzzle data)          │
 * │ SolsticeGame class:                              │
 * │   ├── Level management (load, reset, navigate)   │
 * │   ├── Optics engine (BFS raycasting)             │
 * │   ├── Drift system (timed rotation mechanic)     │
 * │   ├── Renderer (Canvas drawing, sub-methods)     │
 * │   ├── Editor (Creative Lab, share code I/O)      │
 * │   └── Game loop (requestAnimationFrame)          │
 * └─────────────────────────────────────────────────┘
 *
 * Color Model: Bitwise RGB (R=1, G=2, B=4).
 *   Mixing = OR, Filtering = AND. Mathematically correct and order-independent.
 *
 * Raycasting: BFS with visited-set deduplication.
 *   Key format: "x,y,dx,dy,color" — prevents infinite loops from facing mirrors
 *   or portal cycles. O(n) per beam where n = grid cells traversed.
 *
 * Built for the June 2026 Solstice Game Jam (DEV.to).
 */

// ============================================================
// --- Color Bitmasks ---
// Uses 3-bit RGB model: Red=001, Green=010, Blue=100
// Mixing is bitwise OR, filtering is bitwise AND
// ============================================================

/** @enum {number} Color bitmask values */
const COLOR = {
  NONE: 0,
  RED: 1,       // 001
  GREEN: 2,     // 010
  BLUE: 4,      // 100
  YELLOW: 3,    // 011 (Red | Green)
  MAGENTA: 5,   // 101 (Red | Blue)
  CYAN: 6,      // 110 (Green | Blue)
  WHITE: 7      // 111 (Red | Green | Blue)
};

/** @type {Readonly<Record<number, string>>} Map color bitmasks to CSS/Canvas hex colors */
const COLOR_MAP = {
  [COLOR.NONE]: 'rgba(100, 116, 139, 0.2)', // slate
  [COLOR.RED]: '#ff3366',
  [COLOR.GREEN]: '#33ff66',
  [COLOR.BLUE]: '#3366ff',
  [COLOR.YELLOW]: '#ffff33',
  [COLOR.MAGENTA]: '#ff33ff',
  [COLOR.CYAN]: '#33ffff',
  [COLOR.WHITE]: '#ffffff'
};

/** @type {Readonly<Record<number, string>>} Map color bitmasks to RGB triplet strings for rgba() */
const COLOR_RGB_MAP = {
  [COLOR.NONE]: '100, 116, 139',
  [COLOR.RED]: '255, 51, 102',
  [COLOR.GREEN]: '51, 255, 102',
  [COLOR.BLUE]: '51, 102, 255',
  [COLOR.YELLOW]: '255, 255, 51',
  [COLOR.MAGENTA]: '255, 51, 255',
  [COLOR.CYAN]: '51, 255, 255',
  [COLOR.WHITE]: '255, 255, 255'
};

// ============================================================
// --- Component Types ---
// ============================================================

/** @enum {string} Grid component type identifiers */
const TYPE = {
  EMPTY: 'empty',
  WALL: 'wall',
  MIRROR: 'mirror',
  SPLITTER: 'splitter',
  RECEIVER: 'receiver',
  EMITTER: 'emitter',
  PORTAL: 'portal',
  FILTER: 'filter'
};

/** @type {ReadonlySet<string>} Valid component type values for input validation */
const VALID_TYPES = new Set(Object.values(TYPE));

// ============================================================
// --- Directions ---
// ============================================================

/**
 * @typedef {Object} Direction
 * @property {number} x - Horizontal component (-1, 0, or 1)
 * @property {number} y - Vertical component (-1, 0, or 1)
 * @property {string} name - Human-readable name (UP, DOWN, LEFT, RIGHT)
 */

/** @enum {Direction} Cardinal direction vectors */
const DIR = {
  UP: { x: 0, y: -1, name: 'UP' },
  DOWN: { x: 0, y: 1, name: 'DOWN' },
  LEFT: { x: -1, y: 0, name: 'LEFT' },
  RIGHT: { x: 1, y: 0, name: 'RIGHT' }
};

/** @type {ReadonlySet<string>} Valid direction names for input validation */
const VALID_DIR_NAMES = new Set(Object.keys(DIR));

// ============================================================
// --- Canvas Font Constant ---
// Canvas API does not resolve CSS custom properties (var(--font-mono)),
// so we define the resolved font stack as a constant.
// ============================================================

/** @type {string} Resolved monospace font for Canvas text rendering */
const CANVAS_FONT_MONO = '"Share Tech Mono", monospace';

// ============================================================
// --- Performance Constants ---
// ============================================================

/**
 * Maximum number of ray segments allowed during BFS raycasting.
 * Prevents unbounded memory growth from malicious custom levels
 * with circular portal/mirror configurations.
 */
const MAX_BEAM_SEGMENTS = 500;

/**
 * Maximum valid grid size for custom level imports.
 * Prevents performance issues from excessively large grids.
 */
const MAX_GRID_SIZE = 20;

// ============================================================
// --- Direction Helpers ---
// ============================================================

/**
 * Check if two directions are equal by comparing their vector components.
 * @param {Direction} d1 - First direction
 * @param {Direction} d2 - Second direction
 * @returns {boolean} True if directions have identical x and y components
 */
function isSameDir(d1, d2) {
  if (!d1 || !d2) return false;
  return d1.x === d2.x && d1.y === d2.y;
}

/**
 * Rotate a direction 90° clockwise.
 * UP→RIGHT→DOWN→LEFT→UP
 * @param {Direction} dir - Input direction
 * @returns {Direction} The clockwise-rotated direction
 */
function rotateDirCW(dir) {
  if (isSameDir(dir, DIR.UP)) return DIR.RIGHT;
  if (isSameDir(dir, DIR.RIGHT)) return DIR.DOWN;
  if (isSameDir(dir, DIR.DOWN)) return DIR.LEFT;
  if (isSameDir(dir, DIR.LEFT)) return DIR.UP;
  return dir;
}

/**
 * Rotate a direction 90° counter-clockwise.
 * UP→LEFT→DOWN→RIGHT→UP
 * @param {Direction} dir - Input direction
 * @returns {Direction} The counter-clockwise-rotated direction
 */
function rotateDirCCW(dir) {
  if (isSameDir(dir, DIR.UP)) return DIR.LEFT;
  if (isSameDir(dir, DIR.LEFT)) return DIR.DOWN;
  if (isSameDir(dir, DIR.DOWN)) return DIR.RIGHT;
  if (isSameDir(dir, DIR.RIGHT)) return DIR.UP;
  return dir;
}

/**
 * Resolve a direction value that may be a string name or Direction object.
 * Normalizes the dual-type `cell.dir` pattern from level data.
 * @param {Direction|string|null|undefined} dir - Direction to resolve
 * @returns {Direction|null} Resolved Direction object, or null if invalid
 */
function resolveDirection(dir) {
  if (!dir) return null;
  if (typeof dir === 'string') {
    return DIR[dir] || null;
  }
  if (typeof dir === 'object' && typeof dir.x === 'number' && typeof dir.y === 'number') {
    return dir;
  }
  return null;
}

/**
 * Check if the user prefers reduced motion (accessibility).
 * @returns {boolean} True if reduced motion is preferred
 */
function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


// ============================================================
// --- Audio Synthesizer Class ---
// Procedural sound generation using Web Audio API.
// Produces ambient music, SFX, and win jingles with zero audio files.
// ============================================================

/**
 * @class SoundSynth
 * @description Procedural audio synthesizer for all game sounds.
 * Uses Web Audio API oscillators and filters to generate:
 * - Ambient sci-fi background music (pentatonic scale)
 * - UI click/keypress feedback
 * - Drift warning sounds
 * - Victory arpeggio jingle
 */
class SoundSynth {
  constructor() {
    /** @type {AudioContext|null} Web Audio context, lazy-initialized */
    this.ctx = null;
    /** @type {boolean} Whether SFX are muted */
    this.muted = false;
    /** @type {boolean} Whether ambient music is muted */
    this.musicMuted = false;
    /** @type {boolean} Whether ambient music loop is currently active */
    this.ambientPlaying = false;
    /** @type {Array<{osc: OscillatorNode, gain: GainNode, filter: BiquadFilterNode}>} Active ambient audio nodes */
    this.ambientNodes = [];
    /** @type {number|null} Timeout ID for next ambient note scheduling */
    this.ambientTimeout = null;
    /** @type {{osc: OscillatorNode, gain: GainNode}|null} LFO for ambient filter sweep */
    this.ambientLfo = null;
  }

  /**
   * Lazily initialize the AudioContext. Must be called from a user gesture
   * handler to satisfy browser autoplay policies.
   */
  init() {
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {
        console.warn('Web Audio API unavailable:', e.message);
      }
    }
  }

  /**
   * Toggle ambient music on/off.
   * @returns {boolean} New muted state (true = muted)
   */
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    if (this.musicMuted) {
      this.stopAmbient();
    } else {
      this.startAmbient();
    }
    return this.musicMuted;
  }

  /**
   * Start the ambient music loop. Plays random notes from a C minor
   * pentatonic scale with LFO-modulated lowpass filtering.
   */
  startAmbient() {
    if (this.musicMuted) return;
    this.init();
    if (!this.ctx) return;
    if (this.ambientPlaying) return;
    this.ambientPlaying = true;
    
    // Create LFO to sweep filter
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.08, this.ctx.currentTime);
    
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(250, this.ctx.currentTime);
    
    lfo.connect(lfoGain);
    lfo.start();
    
    this.ambientLfo = { osc: lfo, gain: lfoGain };
    
    // Mystery sci-fi pentatonic scale (C minor pentatonic: C3, Eb3, F3, G3, Bb3, C4)
    const notes = [130.81, 155.56, 174.61, 196.00, 233.08, 261.63];
    
    const playNextNote = () => {
      if (!this.ambientPlaying || this.musicMuted) return;
      
      const freq = notes[Math.floor(Math.random() * notes.length)];
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, this.ctx.currentTime);
      
      // Modulate filter cutoff with LFO
      lfoGain.connect(filter.frequency);
      
      // Slow attack and release
      const attack = 2.0;
      const release = 4.0;
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.02, this.ctx.currentTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + attack + release);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + attack + release);
      
      const nodeObj = { osc, gain, filter };
      this.ambientNodes.push(nodeObj);
      
      // Clean up node references after they finish
      setTimeout(() => {
        const index = this.ambientNodes.indexOf(nodeObj);
        if (index > -1) this.ambientNodes.splice(index, 1);
      }, (attack + release + 0.5) * 1000);
      
      // Schedule next note in 3.5 to 5.5 seconds
      const delay = 3500 + Math.random() * 2000;
      this.ambientTimeout = setTimeout(playNextNote, delay);
    };
    
    playNextNote();
  }

  /** Stop ambient music with a smooth fade-out. */
  stopAmbient() {
    this.ambientPlaying = false;
    if (this.ambientTimeout) {
      clearTimeout(this.ambientTimeout);
      this.ambientTimeout = null;
    }
    
    if (this.ambientLfo) {
      try { this.ambientLfo.osc.stop(); } catch(e) { /* already stopped */ }
      this.ambientLfo = null;
    }
    
    this.ambientNodes.forEach(node => {
      try {
        node.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        node.gain.gain.setValueAtTime(node.gain.gain.value, this.ctx.currentTime);
        node.gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
        setTimeout(() => {
          try { node.osc.stop(); } catch(e) { /* already stopped */ }
        }, 400);
      } catch(e) { /* node already disposed */ }
    });
    this.ambientNodes = [];
  }

  /** Play a short click SFX for button/tile interactions. */
  playClick() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  /** Play a subtle keypress SFX for typewriter effect. */
  playKeypress() {
    if (this.muted) return;
    // Don't lazily init AudioContext here because keypress is often triggered by automatic
    // typewriter narrative effects on load before any user gesture, which throws warnings.
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600 + Math.random() * 200, this.ctx.currentTime);
    
    gain.gain.setValueAtTime(0.02, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.03);
  }

  /** Play a descending sawtooth sweep for drift rotation events. */
  playDrift() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  }

  /** Play a major arpeggio (C4-E4-G4-C5) for level completion. */
  playWin() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Play a lovely major arpeggio
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * 0.1);
      
      gain.gain.setValueAtTime(0.0, now + index * 0.1);
      gain.gain.linearRampToValueAtTime(0.1, now + index * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.1 + 0.6);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now + index * 0.1);
      osc.stop(now + index * 0.1 + 0.6);
    });
  }
}

/** @type {SoundSynth} Global synthesizer instance */
const synth = new SoundSynth();


// ============================================================
// --- Type Definitions ---
// ============================================================

/**
 * @typedef {Object} GridPos
 * @property {number} x - Column index (0-based)
 * @property {number} y - Row index (0-based)
 */

/**
 * @typedef {Object} Tile
 * @property {string} type - Component type (TYPE enum value)
 * @property {number} angle - Current rotation angle (0, 90, 180, 270)
 * @property {number} visualAngle - Interpolated angle for smooth animation
 * @property {boolean} rotatable - Whether player can rotate this tile
 * @property {boolean} driftable - Whether Solstice Drift affects this tile
 * @property {number} color - Color bitmask (COLOR enum value)
 * @property {Direction|null} dir - Facing direction for emitters/receivers
 * @property {boolean} locked - Whether beam contact prevents drift rotation
 * @property {number} incomingColor - Accumulated color bitmask from incoming beams
 * @property {number} portalId - Portal channel ID (1=Alpha, 2=Beta, 3=Gamma)
 */

/**
 * @typedef {Object} Ray
 * @property {number} x - Current grid column
 * @property {number} y - Current grid row
 * @property {number} dx - Horizontal direction component
 * @property {number} dy - Vertical direction component
 * @property {number} color - Color bitmask being carried
 * @property {Array<GridPos>} points - Accumulated path points for rendering
 */

/**
 * @typedef {Object} Beam
 * @property {number} color - Color bitmask of this beam segment
 * @property {Array<GridPos>} points - Path points for Canvas rendering
 */

/**
 * @typedef {Object} ReceiverState
 * @property {number} x - Grid column
 * @property {number} y - Grid row
 * @property {number} targetColor - Required color bitmask to activate
 * @property {boolean} active - Whether currently receiving correct color
 */

/**
 * @typedef {Object} EmitterState
 * @property {number} x - Grid column
 * @property {number} y - Grid row
 * @property {number} color - Emitted color bitmask
 * @property {Direction} dir - Emission direction
 */

/**
 * @typedef {Object} LevelDef
 * @property {string} name - Display name (e.g., "01 // Solstice Dawn")
 * @property {string} quote - Narrative text shown on level load
 * @property {number} gridSize - Grid dimensions (gridSize × gridSize)
 * @property {number} driftDuration - Seconds between drift ticks (0 = no drift)
 * @property {Array<Object>} grid - Array of component placement definitions
 */


// ============================================================
// --- Level Configuration ---
// 8 sectors progressively introducing game mechanics.
// All levels verified solvable by brute-force (see test_game.mjs).
// ============================================================

/** @type {LevelDef[]} */
const LEVELS = [
  {
    name: "01 // Solstice Dawn",
    quote: "SYSTEMS ONLINE. \"We can only see a short distance ahead, but we can see plenty there that needs to be done.\" Honoring computer pioneer Alan Turing's legacy: Click a node to rotate mirrors and guide the light.",
    gridSize: 6,
    driftDuration: 0, // No drift
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 3, y: 1, type: TYPE.MIRROR, angle: 90, rotatable: true },
      { x: 3, y: 4, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 5, y: 4, type: TYPE.RECEIVER, color: COLOR.WHITE, dir: DIR.LEFT },
      { x: 4, y: 2, type: TYPE.WALL } // Visual obstacle, doesn't block main path
    ]
  },
  {
    name: "02 // Turing's Prism",
    quote: "PRISM CORE ENGAGED. \"Science is a differential equation. Religion is a boundary condition.\" Paying tribute to Turing's Bombe cipher-breaking: Split white light into component wavelengths to satisfy the receptors.",
    gridSize: 6,
    driftDuration: 0, // No drift
    grid: [
      { x: 0, y: 2, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      // Splitter at 2,2 facing Right (East). White light enters from West, splits: Red (North), Green (East), Blue (South)
      { x: 2, y: 2, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      
      { x: 2, y: 1, type: TYPE.MIRROR, angle: 90, rotatable: true },
      { x: 2, y: 3, type: TYPE.MIRROR, angle: 0, rotatable: true },
      
      { x: 5, y: 1, type: TYPE.RECEIVER, color: COLOR.RED, dir: DIR.LEFT },
      { x: 5, y: 2, type: TYPE.RECEIVER, color: COLOR.GREEN, dir: DIR.LEFT },
      { x: 5, y: 3, type: TYPE.RECEIVER, color: COLOR.BLUE, dir: DIR.LEFT }
    ]
  },
  {
    name: "03 // Pride Synthesis",
    quote: "PRIDE HARMONY ACTIVE. \"Diversity of frequency creates the spectrum of progress.\" Route different emitters to synthesize secondary hues — representing authenticity and community progress.",
    gridSize: 6,
    driftDuration: 0,
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.RED, dir: DIR.RIGHT },
      { x: 0, y: 4, type: TYPE.EMITTER, color: COLOR.BLUE, dir: DIR.RIGHT },
      
      { x: 4, y: 1, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 4, type: TYPE.MIRROR, angle: 0, rotatable: true },
      
      { x: 4, y: 2, type: TYPE.RECEIVER, color: COLOR.MAGENTA, dir: DIR.LEFT }
    ]
  },
  {
    name: "04 // Solstice Liberation",
    quote: "RESONANCE OF LIBERATION. \"Freedom is not a state; it is an act.\" In tribute to Juneteenth and resilience: Direct active light beams to secure and lock the unstable drifting orange nodes.",
    gridSize: 6,
    driftDuration: 10, // 10 seconds per drift tick
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      
      { x: 3, y: 1, type: TYPE.MIRROR, angle: 0, rotatable: true },
      // This mirror drifts!
      { x: 3, y: 4, type: TYPE.MIRROR, angle: 90, rotatable: true, driftable: true },
      
      { x: 5, y: 4, type: TYPE.RECEIVER, color: COLOR.WHITE, dir: DIR.LEFT }
    ]
  },
  {
    name: "05 // Crypt-Breaker",
    quote: "CYPHER RESOLUTION. \"We can only see a short distance ahead, but we can see plenty there that needs to be done.\" Deploy all optical techniques: Splitting, synthesis, and liberation locking.",
    gridSize: 6,
    driftDuration: 12,
    grid: [
      // Emitter
      { x: 0, y: 2, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      
      // Splitter
      { x: 2, y: 2, type: TYPE.SPLITTER, angle: 0, rotatable: false }, // White -> Red(N), Green(E), Blue(S)
      
      // Mirrors for Red (North path)
      { x: 2, y: 0, type: TYPE.MIRROR, angle: 90, rotatable: true },
      { x: 4, y: 0, type: TYPE.MIRROR, angle: 0, rotatable: true, driftable: true },
      
      // Mirrors for Blue (South path)
      { x: 2, y: 4, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 4, type: TYPE.MIRROR, angle: 90, rotatable: true, driftable: true },
      
      // Receivers
      { x: 4, y: 3, type: TYPE.RECEIVER, color: COLOR.MAGENTA, dir: DIR.UP }, // Receives combined Red & Blue
      { x: 5, y: 2, type: TYPE.RECEIVER, color: COLOR.GREEN, dir: DIR.LEFT }  // Receives Green
    ]
  },
  {
    name: "06 // Quantum Tunnel",
    quote: "QUANTUM BRIDGE ESTABLISHED. \"The path to truth is rarely a straight line.\" Harness Optic Portals to bend space itself and route light across impenetrable walls.",
    gridSize: 6,
    driftDuration: 0,
    grid: [
      { x: 0, y: 3, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 2, y: 3, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      // Portals
      { x: 2, y: 2, type: TYPE.PORTAL, portalId: 1 },
      { x: 4, y: 1, type: TYPE.PORTAL, portalId: 1 },
      { x: 2, y: 4, type: TYPE.PORTAL, portalId: 2 },
      { x: 4, y: 4, type: TYPE.PORTAL, portalId: 2 },
      // Walls
      { x: 4, y: 3, type: TYPE.WALL },
      { x: 3, y: 1, type: TYPE.WALL },
      { x: 3, y: 4, type: TYPE.WALL },
      // Mirrors
      { x: 4, y: 0, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 5, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 3, y: 3, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 3, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 5, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: true },
      // Receivers
      { x: 5, y: 0, type: TYPE.RECEIVER, color: COLOR.RED, dir: DIR.LEFT },
      { x: 5, y: 3, type: TYPE.RECEIVER, color: COLOR.GREEN, dir: DIR.LEFT },
      { x: 5, y: 5, type: TYPE.RECEIVER, color: COLOR.BLUE, dir: DIR.LEFT }
    ]
  },
  {
    name: "07 // Spectral Sieve",
    quote: "SPECTRAL PURIFICATION. \"Wavelengths separated, truth isolated.\" Use light filters to screen out unwanted color channels and synthesize the exact required frequencies.",
    gridSize: 6,
    driftDuration: 0,
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 0, y: 4, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      // Filters
      { x: 2, y: 1, type: TYPE.FILTER, color: COLOR.YELLOW }, // Red + Green
      { x: 2, y: 4, type: TYPE.FILTER, color: COLOR.CYAN },   // Green + Blue
      // Splitters
      { x: 3, y: 1, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      { x: 3, y: 4, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      // Mirrors (rotatable)
      { x: 3, y: 0, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 3, y: 5, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 1, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 4, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 4, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: true },
      // Receivers
      { x: 5, y: 0, type: TYPE.RECEIVER, color: COLOR.RED, dir: DIR.LEFT },
      { x: 5, y: 5, type: TYPE.RECEIVER, color: COLOR.BLUE, dir: DIR.LEFT },
      { x: 5, y: 2, type: TYPE.RECEIVER, color: COLOR.GREEN, dir: DIR.LEFT }
    ]
  },
  {
    name: "08 // The Grand Solstice",
    quote: "CORE SOLSTICE COMPLETED. \"The light shines in the darkness, and the darkness has not overcome it.\" The ultimate convergence: Deploy portals, splitters, filters, and drift locks simultaneously.",
    gridSize: 7,
    driftDuration: 15,
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 0, y: 5, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      // Splitters
      { x: 2, y: 1, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      { x: 2, y: 5, type: TYPE.SPLITTER, angle: 0, rotatable: false },
      // Portals
      { x: 4, y: 2, type: TYPE.PORTAL, portalId: 1 },
      { x: 5, y: 2, type: TYPE.PORTAL, portalId: 1 },
      { x: 4, y: 4, type: TYPE.PORTAL, portalId: 2 },
      { x: 5, y: 4, type: TYPE.PORTAL, portalId: 2 },
      // Drifting Mirrors (Angles scrambled so it doesn't autocomplete on load)
      { x: 2, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: true, driftable: true },
      { x: 2, y: 4, type: TYPE.MIRROR, angle: 90, rotatable: true, driftable: true },
      // Standard Mirrors (rotatable)
      { x: 2, y: 0, type: TYPE.MIRROR, angle: 90, rotatable: true },
      { x: 6, y: 0, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 2, y: 6, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 6, y: 6, type: TYPE.MIRROR, angle: 90, rotatable: true },
      { x: 6, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: true },
      { x: 6, y: 4, type: TYPE.MIRROR, angle: 90, rotatable: true },
      // Receivers
      { x: 6, y: 1, type: TYPE.RECEIVER, color: COLOR.YELLOW, dir: DIR.LEFT },
      { x: 6, y: 5, type: TYPE.RECEIVER, color: COLOR.CYAN, dir: DIR.LEFT },
      { x: 6, y: 3, type: TYPE.RECEIVER, color: COLOR.MAGENTA, dir: DIR.LEFT }
    ]
  }
];


// ============================================================
// --- Game Engine Class ---
// ============================================================

/**
 * @class SolsticeGame
 * @description Main game engine handling level management, optics simulation,
 * rendering, user input, and the Creative Lab editor.
 *
 * The engine uses a BFS-based raycasting algorithm to trace light beams
 * through the grid. Beams interact with components (mirrors, splitters,
 * portals, filters) according to deterministic rules. A visited-set
 * prevents infinite loops from circular configurations.
 */
class SolsticeGame {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this.canvas = document.getElementById('game-canvas');
    if (!this.canvas) {
      console.error('SolsticeGame: Canvas element #game-canvas not found');
      return;
    }

    /** @type {CanvasRenderingContext2D|null} */
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      console.error('SolsticeGame: Could not get 2D rendering context');
      return;
    }

    // Apply HiDPI / Retina scaling
    this._applyDevicePixelRatio();

    /** @type {number|string} Current level index (number for LEVELS[], 'custom' for editor) */
    this.currentLevelIndex = 0;
    /** @type {Tile[][]} 2D grid matrix [row][col] */
    this.grid = [];
    /** @type {Beam[]} Computed beam segments for rendering */
    this.beams = [];
    /** @type {ReceiverState[]} Active receiver tracking */
    this.receivers = [];
    /** @type {EmitterState[]} Active emitter list */
    this.emitters = [];
    
    // Layout parameters (logical pixels, pre-DPR)
    /** @type {number} Cell size in logical pixels */
    this.cellSize = 70;
    /** @type {{x: number, y: number}} Grid origin offset for centering */
    this.gridOffset = { x: 50, y: 50 };
    
    // Drift state variables
    /** @type {number} Accumulated drift time in seconds */
    this.driftTimer = 0;
    /** @type {number} Seconds between drift ticks (0 = disabled) */
    this.driftDuration = 0;
    /** @type {number} Last frame timestamp for delta-time calculation */
    this.lastTime = 0;
    /** @type {number} Current frame timestamp from requestAnimationFrame */
    this.frameTime = 0;
    
    // Typewriter effect state
    /** @type {number|null} Active typewriter setTimeout ID */
    this.typewriterTimeout = null;
    
    /** @type {boolean} Whether current level is solved */
    this.isWon = false;
    /** @type {GridPos|null} Mouse hover grid position */
    this.hoverTile = null;
    /** @type {string} Editor mode: 'design' or 'play' */
    this.editorMode = 'design';
    /** @type {GridPos} Keyboard cursor position */
    this.selectedTile = { x: 0, y: 0 };

    /**
     * Pre-built portal pair lookup map for O(1) pairing.
     * Maps portalId → array of {x, y} positions.
     * Rebuilt on each loadLevel() and placeComponentAt() call.
     * @type {Map<number, GridPos[]>}
     */
    this.portalMap = new Map();

    /**
     * Custom level data for the Creative Lab editor.
     * @type {LevelDef|null}
     */
    this.customLevel = null;

    /** @type {boolean} Whether user prefers reduced motion */
    this.reducedMotion = prefersReducedMotion();
    
    // Setup event listeners
    this.initEvents();
  }

  // ============================================================
  // --- Utility Helpers ---
  // ============================================================

  /**
   * Apply devicePixelRatio scaling to the canvas for sharp rendering
   * on HiDPI/Retina displays. The canvas logical size stays at 640×640
   * but the backing store is scaled up.
   * @private
   */
  _applyDevicePixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 640;
    const logicalHeight = 640;
    this.canvas.width = logicalWidth * dpr;
    this.canvas.height = logicalHeight * dpr;
    this.canvas.style.width = logicalWidth + 'px';
    this.canvas.style.height = logicalHeight + 'px';
    this.ctx.scale(dpr, dpr);
  }

  /**
   * Get the grid size of the current level.
   * Eliminates the repeated ternary `currentLevelIndex === 'custom' ? ... : ...`
   * @returns {number} Grid dimension (e.g., 6 for a 6×6 grid)
   */
  getGridSize() {
    if (this.currentLevelIndex === 'custom') {
      return this.customLevel ? this.customLevel.gridSize : 6;
    }
    return LEVELS[this.currentLevelIndex].gridSize;
  }

  /**
   * Get the current level definition object.
   * @returns {LevelDef|null} Current level, or null if invalid
   */
  getCurrentLevel() {
    if (this.currentLevelIndex === 'custom') {
      return this.customLevel;
    }
    if (typeof this.currentLevelIndex === 'number' &&
        this.currentLevelIndex >= 0 &&
        this.currentLevelIndex < LEVELS.length) {
      return LEVELS[this.currentLevelIndex];
    }
    return null;
  }

  /**
   * Convert grid coordinates to pixel center position (for beam/component rendering).
   * @param {number} col - Grid column
   * @param {number} row - Grid row
   * @returns {{x: number, y: number}} Pixel center position
   */
  gridToPixel(col, row) {
    return {
      x: this.gridOffset.x + (col + 0.5) * this.cellSize,
      y: this.gridOffset.y + (row + 0.5) * this.cellSize
    };
  }

  /**
   * Convert grid coordinates to top-left pixel position (for cell backgrounds).
   * @param {number} col - Grid column
   * @param {number} row - Grid row
   * @returns {{x: number, y: number}} Pixel top-left position
   */
  gridToPixelTopLeft(col, row) {
    return {
      x: this.gridOffset.x + col * this.cellSize,
      y: this.gridOffset.y + row * this.cellSize
    };
  }

  /**
   * Build the portal pair lookup map from the current grid state.
   * Maps each portalId to an array of {x, y} positions.
   * Called after loadLevel() and placeComponentAt().
   * @private
   */
  _buildPortalMap() {
    this.portalMap.clear();
    const size = this.getGridSize();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = this.grid[r][c];
        if (tile.type === TYPE.PORTAL) {
          const id = tile.portalId || 1;
          if (!this.portalMap.has(id)) {
            this.portalMap.set(id, []);
          }
          this.portalMap.get(id).push({ x: c, y: r });
        }
      }
    }
  }

  /**
   * Create a default empty tile object.
   * @returns {Tile} Fresh tile with default values
   * @private
   */
  _createEmptyTile() {
    return {
      type: TYPE.EMPTY,
      angle: 0,
      visualAngle: 0,
      rotatable: false,
      driftable: false,
      color: COLOR.NONE,
      dir: null,
      locked: false,
      incomingColor: COLOR.NONE,
      portalId: 1
    };
  }

  // ============================================================
  // --- Level Management ---
  // ============================================================

  /**
   * Load a level by index or 'custom' for the Creative Lab.
   * Initializes the grid, emitters, receivers, drift timer, portal map,
   * and triggers the narrative typewriter.
   * @param {number|string} index - Level index (0–7) or 'custom'
   */
  loadLevel(index) {
    // Validate level index
    if (typeof index === 'number' && (index < 0 || index >= LEVELS.length)) {
      console.error(`SolsticeGame: Invalid level index ${index}`);
      return;
    }

    this.currentLevelIndex = index;
    
    /** @type {LevelDef} */
    let lvl;
    if (index === 'custom') {
      if (!this.customLevel) {
        this.customLevel = {
          name: "🛠 // Creative Lab",
          quote: "CREATIVE MODE ACTIVE. Configure elements using the panel, click on tiles to place them. Toggle to PLAY mode to test your circuits, and export your decryption challenge for others.",
          gridSize: 6,
          driftDuration: 0,
          grid: []
        };
      }
      lvl = this.customLevel;
      document.getElementById('console-panel').style.display = 'none';
      document.getElementById('editor-panel').style.display = 'flex';
      
      // Synchronize the Grid Size selector
      const editorGridSize = document.getElementById('editor-grid-size');
      if (editorGridSize) {
        editorGridSize.value = lvl.gridSize.toString();
      }

      // Reset editor mode to design on entry
      this.editorMode = 'design';
      const editBtn = document.getElementById('btn-edit-mode');
      if (editBtn) { editBtn.innerText = 'MODE: DESIGN'; editBtn.className = 'terminal-btn btn-primary'; }
    } else {
      lvl = LEVELS[index];
      document.getElementById('console-panel').style.display = 'flex';
      document.getElementById('editor-panel').style.display = 'none';
    }
    
    this.grid = [];
    this.receivers = [];
    this.emitters = [];
    this.isWon = false;
    this.selectedTile = { x: 0, y: 0 }; // Reset keyboard cursor position
    
    // Initialize 2D grid matrix
    const size = lvl.gridSize;
    for (let r = 0; r < size; r++) {
      this.grid[r] = [];
      for (let c = 0; c < size; c++) {
        this.grid[r][c] = this._createEmptyTile();
      }
    }
    
    // Load level elements
    lvl.grid.forEach(cell => {
      let mappedDir = resolveDirection(cell.dir);
      if ((cell.type === TYPE.EMITTER || cell.type === TYPE.RECEIVER) && !mappedDir) {
        mappedDir = DIR.RIGHT;
      }
      
      // Validate coordinates are within bounds
      if (cell.x < 0 || cell.x >= size || cell.y < 0 || cell.y >= size) {
        console.warn(`SolsticeGame: Skipping out-of-bounds cell at (${cell.x}, ${cell.y})`);
        return;
      }
      
      this.grid[cell.y][cell.x] = {
        type: cell.type,
        angle: cell.angle || 0,
        visualAngle: cell.angle || 0,
        rotatable: cell.rotatable !== undefined ? cell.rotatable : false,
        driftable: cell.driftable !== undefined ? cell.driftable : false,
        color: cell.color || COLOR.NONE,
        dir: mappedDir,
        locked: false,
        incomingColor: COLOR.NONE,
        portalId: cell.portalId || 1
      };
      
      if (cell.type === TYPE.RECEIVER) {
        this.receivers.push({ x: cell.x, y: cell.y, targetColor: cell.color, active: false });
      }
      if (cell.type === TYPE.EMITTER) {
        this.emitters.push({ x: cell.x, y: cell.y, color: cell.color, dir: mappedDir });
      }
    });
    
    // Build portal lookup map for O(1) pairing
    this._buildPortalMap();
    
    // Setup drift timer
    this.driftDuration = lvl.driftDuration;
    this.driftTimer = 0;
    
    const driftBox = document.getElementById('drift-warning');
    if (this.driftDuration > 0) {
      driftBox.className = "drift-warning-box active";
      document.getElementById('drift-time-text').innerText = `${this.driftDuration.toFixed(1)}s`;
    } else {
      driftBox.className = "drift-warning-box idled";
      document.getElementById('drift-time-text').innerText = "STABLE";
      document.getElementById('drift-progress-fill').style.width = "0%";
    }
    
    // Reset overlays
    document.getElementById('win-overlay').classList.remove('active');
    document.getElementById('level-select').value = index;
    
    // Run typewriter text
    this.triggerTypewriter("TURING_IMPRINT", lvl.quote);
    
    // Update input boxes if custom
    if (index === 'custom') {
      this.updateCustomCode();
    }
    
    // Recalculate paths
    this.updateBeams();
  }

  // ============================================================
  // --- Creative Lab Editor ---
  // ============================================================

  /**
   * Serialize the current custom level grid to a Base64-encoded share code.
   * @returns {string} Base64-encoded level data
   */
  exportCustomCode() {
    if (!this.customLevel) return '';
    const size = this.customLevel.gridSize;
    const savedGrid = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = this.grid[r][c];
        if (tile.type !== TYPE.EMPTY) {
          savedGrid.push({
            x: c,
            y: r,
            type: tile.type,
            angle: tile.angle,
            rotatable: tile.rotatable,
            driftable: tile.driftable,
            color: tile.color,
            dir: tile.dir ? tile.dir.name : null,
            portalId: tile.portalId || 1
          });
        }
      }
    }
    this.customLevel.grid = savedGrid;
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(this.customLevel))));
    } catch(e) {
      console.error('Failed to encode share code:', e);
      return '';
    }
  }

  /**
   * Serialize the current custom level grid to a Base64-encoded share code
   * and update the textarea in the editor panel.
   */
  updateCustomCode() {
    if (this.currentLevelIndex !== 'custom') return;
    const codeStr = this.exportCustomCode();
    const ioEl = document.getElementById('custom-code-io');
    if (ioEl) {
      ioEl.value = codeStr;
    }
  }

  /**
   * Import a custom level from a Base64-encoded share code string.
   * Validates the decoded data before loading.
   * @param {string} codeStr - Base64-encoded level data
   */
  importCustomCode(codeStr) {
    try {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(codeStr.trim()))));
      
      // Validate structure
      if (!decoded || typeof decoded !== 'object') {
        this.triggerTypewriter("SYSTEM_CORE", "ERROR: Invalid share code format. Expected a valid level structure.");
        return;
      }
      
      // Validate gridSize
      if (typeof decoded.gridSize !== 'number' || decoded.gridSize < 1 || decoded.gridSize > MAX_GRID_SIZE) {
        this.triggerTypewriter("SYSTEM_CORE", `ERROR: Grid size must be between 1 and ${MAX_GRID_SIZE}. Received: ${decoded.gridSize}`);
        return;
      }
      
      if (!Array.isArray(decoded.grid)) {
        this.triggerTypewriter("SYSTEM_CORE", "ERROR: Invalid share code — missing grid data.");
        return;
      }
      
      // Validate and normalize each grid cell
      const validatedGrid = [];
      for (const cell of decoded.grid) {
        // Validate type
        if (!VALID_TYPES.has(cell.type)) {
          console.warn(`Skipping unknown component type: ${cell.type}`);
          continue;
        }
        
        // Validate coordinates
        if (typeof cell.x !== 'number' || typeof cell.y !== 'number' ||
            cell.x < 0 || cell.x >= decoded.gridSize ||
            cell.y < 0 || cell.y >= decoded.gridSize) {
          console.warn(`Skipping out-of-bounds cell at (${cell.x}, ${cell.y})`);
          continue;
        }
        
        // Validate color bitmask (0–7)
        if (cell.color !== undefined && (typeof cell.color !== 'number' || cell.color < 0 || cell.color > 7)) {
          cell.color = COLOR.NONE;
        }
        
        // Normalize direction
        if (typeof cell.dir === 'string') {
          cell.dir = DIR[cell.dir] || DIR.RIGHT;
        }
        
        validatedGrid.push(cell);
      }
      decoded.grid = validatedGrid;
      
      this.customLevel = decoded;
      this.loadLevel('custom');
      this.triggerTypewriter("SYSTEM_CORE", "SHARE CODE DECODED. Level loaded successfully.");
    } catch(e) {
      this.triggerTypewriter("SYSTEM_CORE", "ERROR: Failed to decode share code. Ensure it is a valid Solstice Crypt share code.");
    }
  }

  // ============================================================
  // --- Event Initialization ---
  // ============================================================

  /**
   * Initialize all DOM event listeners for game controls, canvas input,
   * keyboard navigation, and editor panel interactions.
   * @private
   */
  initEvents() {
    // Make canvas focusable for keyboard navigation
    this.canvas.setAttribute('tabindex', '0');
    
    // Canvas click
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

    // Mouse move tracking for hover highlights
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / (rect.width * (window.devicePixelRatio || 1));
      const scaleY = this.canvas.height / (rect.height * (window.devicePixelRatio || 1));
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      const gridX = Math.floor((mx - this.gridOffset.x) / this.cellSize);
      const gridY = Math.floor((my - this.gridOffset.y) / this.cellSize);
      const size = this.getGridSize();
      if (gridX >= 0 && gridX < size && gridY >= 0 && gridY < size) {
        this.hoverTile = { x: gridX, y: gridY };
      } else {
        this.hoverTile = null;
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverTile = null;
    });
    
    // Keyboard navigation controls
    this.canvas.addEventListener('keydown', (e) => {
      if (this.isWon) return;
      const size = this.getGridSize();
      
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          this.selectedTile.y = (this.selectedTile.y - 1 + size) % size;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          this.selectedTile.y = (this.selectedTile.y + 1) % size;
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          this.selectedTile.x = (this.selectedTile.x - 1 + size) % size;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          this.selectedTile.x = (this.selectedTile.x + 1) % size;
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (this.currentLevelIndex === 'custom' && this.editorMode === 'design') {
            this.placeComponentAt(this.selectedTile.x, this.selectedTile.y);
          } else {
            const tile = this.grid[this.selectedTile.y][this.selectedTile.x];
            if (tile.rotatable) {
              tile.angle = (tile.angle + 90) % 360;
              synth.playClick();
              this.updateBeams();
              if (this.currentLevelIndex === 'custom') this.updateCustomCode();
            }
          }
          break;
      }
    });
    
    // Control inputs
    document.getElementById('level-select').addEventListener('change', (e) => {
      synth.playClick();
      const val = e.target.value;
      if (val === 'custom') {
        this.loadLevel('custom');
      } else {
        this.loadLevel(parseInt(val));
      }
    });
    
    document.getElementById('btn-reset').addEventListener('click', () => {
      synth.playClick();
      this.loadLevel(this.currentLevelIndex);
    });
    
    const soundBtn = document.getElementById('btn-sound');
    soundBtn.addEventListener('click', () => {
      synth.muted = !synth.muted;
      soundBtn.innerText = synth.muted ? "UNMUTE SFX" : "MUTE SFX";
      soundBtn.classList.toggle('btn-danger', synth.muted);
      synth.playClick();
    });

    const musicBtn = document.getElementById('btn-music');
    musicBtn.addEventListener('click', () => {
      synth.init();
      const isMuted = synth.toggleMusic();
      musicBtn.innerText = isMuted ? "PLAY MUSIC" : "MUTE MUSIC";
      musicBtn.classList.toggle('btn-danger', isMuted);
      synth.playClick();
    });
    
    document.getElementById('btn-start-game').addEventListener('click', () => {
      synth.init();
      synth.playClick();
      synth.startAmbient();
      document.getElementById('start-overlay').classList.remove('active');
    });
    
    document.getElementById('btn-next-level').addEventListener('click', () => {
      synth.playClick();
      let nextLvl;
      if (this.currentLevelIndex === 'custom') {
        nextLvl = 0;
      } else if (this.currentLevelIndex === LEVELS.length - 1) {
        nextLvl = 'custom';
      } else {
        nextLvl = this.currentLevelIndex + 1;
      }
      this.loadLevel(nextLvl);
    });

    const backBtn = document.getElementById('btn-back-to-editor');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        synth.playClick();
        document.getElementById('win-overlay').classList.remove('active');
        this.isWon = false;
        this.loadLevel('custom');
      });
    }

    // --- Level Editor Event Handlers ---
    this._initEditorEvents();
  }

  /**
   * Initialize Creative Lab editor-specific event listeners.
   * Separated from initEvents() for architectural clarity.
   * @private
   */
  _initEditorEvents() {
    this.editorMode = 'design';
    const editorItem = document.getElementById('editor-item');
    const editorColorRow = document.getElementById('editor-color-row');
    const editorDirRow = document.getElementById('editor-dir-row');
    const editorCheckboxRow = document.getElementById('editor-checkbox-row');
    const editorPortalRow = document.getElementById('editor-portal-row');
    const editorGridSize = document.getElementById('editor-grid-size');
    
    if (editorGridSize) {
      editorGridSize.addEventListener('change', (e) => {
        synth.playClick();
        const newSize = parseInt(e.target.value);
        if (this.currentLevelIndex === 'custom' && this.customLevel) {
          // Export current grid components first
          this.exportCustomCode();
          // Filter out components that fall outside the new dimensions
          this.customLevel.grid = this.customLevel.grid.filter(c => c.x < newSize && c.y < newSize);
          this.customLevel.gridSize = newSize;
          this.loadLevel('custom');
        }
      });
    }
    
    editorItem.addEventListener('change', () => {
      const item = editorItem.value;
      editorColorRow.style.display = 'none';
      editorDirRow.style.display = 'none';
      editorCheckboxRow.style.display = 'none';
      editorPortalRow.style.display = 'none';
      
      if (item === TYPE.EMITTER || item === TYPE.RECEIVER) {
        editorColorRow.style.display = 'block';
        editorDirRow.style.display = 'block';
      } else if (item === TYPE.FILTER) {
        editorColorRow.style.display = 'block';
      } else if (item === TYPE.MIRROR) {
        editorDirRow.style.display = 'block';
        editorCheckboxRow.style.display = 'block';
      } else if (item === TYPE.SPLITTER) {
        editorDirRow.style.display = 'block';
      } else if (item === TYPE.PORTAL) {
        editorPortalRow.style.display = 'block';
      }
    });

    const editModeBtn = document.getElementById('btn-edit-mode');
    editModeBtn.addEventListener('click', () => {
      synth.playClick();
      if (this.editorMode === 'design') {
        this.editorMode = 'play';
        editModeBtn.innerText = "MODE: PLAY";
        editModeBtn.className = "terminal-btn btn-success";
      } else {
        this.editorMode = 'design';
        editModeBtn.innerText = "MODE: DESIGN";
        editModeBtn.className = "terminal-btn btn-primary";
      }
    });

    document.getElementById('btn-clear-grid').addEventListener('click', () => {
      synth.playClick();
      // Use in-game confirmation instead of blocking confirm() dialog
      this.customLevel.grid = [];
      this.loadLevel('custom');
      this.triggerTypewriter("SYSTEM_CORE", "Grid cleared. All components removed.");
    });

    // Single clipboard handler for copy button (removed duplicate textarea click handler)
    const btnCopy = document.getElementById('btn-copy-code');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        synth.playClick();
        const codeTextarea = document.getElementById('custom-code-io');
        const code = codeTextarea.value;
        if (code && code.trim()) {
          navigator.clipboard.writeText(code.trim()).then(() => {
            const status = document.getElementById('copy-status');
            if (status) {
              status.style.display = 'inline';
              setTimeout(() => { status.style.display = 'none'; }, 2000);
            }
          }).catch(err => {
            console.error("Clipboard write failed:", err);
            this.triggerTypewriter("SYSTEM_CORE", "ERROR: Could not copy to clipboard. Please select and copy manually.");
          });
        } else {
          this.triggerTypewriter("SYSTEM_CORE", "No share code generated. Place some components on the grid first.");
        }
      });
    }

    document.getElementById('btn-import-code').addEventListener('click', () => {
      synth.playClick();
      const val = document.getElementById('custom-code-io').value;
      if (val) {
        this.importCustomCode(val);
      } else {
        this.triggerTypewriter("SYSTEM_CORE", "Please paste a share code in the text area first.");
      }
    });

    // Load Demo Puzzle button — copies demo code into import field and loads it
    const btnLoadDemo = document.getElementById('btn-load-demo');
    if (btnLoadDemo) {
      btnLoadDemo.addEventListener('click', () => {
        synth.playClick();
        const demoCode = document.getElementById('lab-demo-code').value;
        document.getElementById('custom-code-io').value = demoCode;
        this.importCustomCode(demoCode);
        // Collapse the guide after loading
        const guide = document.getElementById('lab-guide');
        if (guide) guide.removeAttribute('open');
      });
    }
    
    // Trigger initial change event to ensure selector state is synced
    if (editorItem && typeof editorItem.dispatchEvent === 'function') {
      editorItem.dispatchEvent(new Event('change'));
    }
  }

  // ============================================================
  // --- Input Handling ---
  // ============================================================

  /**
   * Handle canvas click events. Determines which grid cell was clicked
   * and either rotates the component (play mode) or places a new one (editor).
   * @param {MouseEvent} e - Click event
   */
  handleCanvasClick(e) {
    if (this.isWon) return;
    
    const rect = this.canvas.getBoundingClientRect();
    
    // Account for CSS scaling and devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const scaleX = this.canvas.width / (rect.width * dpr);
    const scaleY = this.canvas.height / (rect.height * dpr);
    
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    
    // Check if within grid bounds
    const gridX = Math.floor((mx - this.gridOffset.x) / this.cellSize);
    const gridY = Math.floor((my - this.gridOffset.y) / this.cellSize);
    
    const size = this.getGridSize();
    
    if (gridX >= 0 && gridX < size && gridY >= 0 && gridY < size) {
      // Focus canvas to enable keyboard controls — preventScroll avoids mobile keyboard popup
      this.canvas.focus({ preventScroll: true });
      this.selectedTile = { x: gridX, y: gridY };
      
      const tile = this.grid[gridY][gridX];
      if (this.currentLevelIndex === 'custom' && this.editorMode === 'design') {
        this.placeComponentAt(gridX, gridY);
      } else {
        if (tile.rotatable) {
          // Rotate clockwise by 90 degrees
          tile.angle = (tile.angle + 90) % 360;
          synth.playClick();
          this.updateBeams();
          if (this.currentLevelIndex === 'custom') this.updateCustomCode();
        }
      }
    }
  }

  /**
   * Place a component from the editor panel at the specified grid position.
   * Reads component settings from the editor DOM controls.
   * @param {number} x - Grid column
   * @param {number} y - Grid row
   */
  placeComponentAt(x, y) {
    const editorItem = document.getElementById('editor-item').value;
    const editorColor = parseInt(document.getElementById('editor-color').value);
    const editorDirName = document.getElementById('editor-dir').value;
    const editorRotatable = document.getElementById('editor-rotatable').checked;
    const editorDriftable = document.getElementById('editor-driftable').checked;
    const editorPortalId = parseInt(document.getElementById('editor-portal-id').value);
    
    const tile = this.grid[y][x];
    tile.type = editorItem;
    tile.color = COLOR.NONE;
    tile.dir = null;
    tile.angle = 0;
    tile.visualAngle = 0;
    tile.rotatable = false;
    tile.driftable = false;
    tile.portalId = 1;
    
    if (editorItem === TYPE.EMITTER) {
      tile.color = editorColor;
      tile.dir = DIR[editorDirName] || DIR.RIGHT;
    } else if (editorItem === TYPE.RECEIVER) {
      tile.color = editorColor;
      tile.dir = DIR[editorDirName] || DIR.RIGHT;
    } else if (editorItem === TYPE.FILTER) {
      tile.color = editorColor;
    } else if (editorItem === TYPE.MIRROR) {
      tile.angle = (editorDirName === 'DOWN' || editorDirName === 'UP') ? 90 : 0;
      tile.visualAngle = tile.angle;
      tile.rotatable = editorRotatable;
      tile.driftable = editorDriftable;
    } else if (editorItem === TYPE.SPLITTER) {
      let rotAngle = 0;
      if (editorDirName === 'DOWN') rotAngle = 90;
      if (editorDirName === 'LEFT') rotAngle = 180;
      if (editorDirName === 'UP') rotAngle = 270;
      tile.angle = rotAngle;
      tile.visualAngle = rotAngle;
    } else if (editorItem === TYPE.PORTAL) {
      tile.portalId = editorPortalId;
    }
    
    // Recalculate receivers and emitters list
    this.receivers = [];
    this.emitters = [];
    const size = this.customLevel.gridSize;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const t = this.grid[r][c];
        if (t.type === TYPE.RECEIVER) {
          this.receivers.push({ x: c, y: r, targetColor: t.color, active: false });
        }
        if (t.type === TYPE.EMITTER) {
          this.emitters.push({ x: c, y: r, color: t.color, dir: t.dir });
        }
      }
    }
    
    // Rebuild portal map after placement
    this._buildPortalMap();
    
    synth.playClick();
    this.updateBeams();
    this.updateCustomCode();
  }

  // ============================================================
  // --- Core Optics Engine (BFS Raycasting) ---
  //
  // Algorithm: Breadth-first traversal of light rays through the grid.
  //
  // 1. Initialize BFS queue from all emitter positions
  // 2. For each ray in the queue:
  //    a. Check visited set (key: "x,y,dx,dy,color") — skip if seen
  //    b. Step to next grid cell in ray direction
  //    c. Handle component interaction (reflect, split, teleport, filter, block)
  //    d. Queue child rays as needed
  // 3. After BFS completes, evaluate receiver satisfaction
  //
  // Complexity: O(V + E) where V = grid cells × directions × colors visited,
  //             E = component interactions. Bounded by MAX_BEAM_SEGMENTS.
  //
  // The visited-set prevents infinite loops from:
  // - Facing mirrors bouncing rays back and forth
  // - Portal cycles (A→B→A→B...)
  // - Any other circular configuration
  // ============================================================

  /**
   * Trace all light beams through the grid using BFS raycasting.
   * Updates `this.beams` for rendering and evaluates win condition.
   */
  updateBeams() {
    const size = this.getGridSize();
    
    // Reset incoming cell colors and lock states
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        this.grid[r][c].incomingColor = COLOR.NONE;
        this.grid[r][c].locked = false;
      }
    }
    
    this.beams = [];
    
    // Visited set for infinite loop detection
    // Key format: "x,y,dx,dy,color"
    const visited = new Set();
    
    // Queue of rays to trace
    /** @type {Ray[]} */
    const queue = [];
    
    // Total segment counter for safety cap
    let totalSegments = 0;
    
    // Initialize queue from emitters
    this.emitters.forEach(emitter => {
      queue.push({
        x: emitter.x,
        y: emitter.y,
        dx: emitter.dir.x,
        dy: emitter.dir.y,
        color: emitter.color,
        points: [{ x: emitter.x, y: emitter.y }]
      });
      // Emitters shine light onto their own cells
      this.grid[emitter.y][emitter.x].incomingColor |= emitter.color;
    });
    
    while (queue.length > 0) {
      // Safety cap: prevent unbounded memory from malicious custom levels
      if (totalSegments >= MAX_BEAM_SEGMENTS) {
        // Flush remaining rays as terminal beams
        while (queue.length > 0) {
          this.beams.push(queue.shift());
        }
        break;
      }
      
      const ray = queue.shift();
      const key = `${ray.x},${ray.y},${ray.dx},${ray.dy},${ray.color}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      
      // Step to next grid coordinate
      const nextX = ray.x + ray.dx;
      const nextY = ray.y + ray.dy;
      
      // Bounds check
      if (nextX < 0 || nextX >= size || nextY < 0 || nextY >= size) {
        // Save terminal ray path segment
        ray.points.push({ x: nextX, y: nextY });
        this.beams.push(ray);
        totalSegments++;
        continue;
      }
      
      const tile = this.grid[nextY][nextX];
      
      // Record color entering this cell
      tile.incomingColor |= ray.color;
      
      // Optical lock: if beam hits a driftable node, it gets locked in place
      if (tile.driftable) {
        tile.locked = true;
      }
      
      ray.points.push({ x: nextX, y: nextY });
      
      // Handle tile interaction
      if (tile.type === TYPE.WALL) {
        this.beams.push(ray); // Blocked
        totalSegments++;
      } 
      else if (tile.type === TYPE.RECEIVER) {
        this.beams.push(ray); // Terminate at receiver
        totalSegments++;
      } 
      else if (tile.type === TYPE.MIRROR) {
        this.beams.push(ray);
        totalSegments++;
        // Flat diagonal mirrors reflection logic
        let ndx = 0;
        let ndy = 0;
        
        if (tile.angle === 0 || tile.angle === 180) { // "/" Mirror
          ndx = -ray.dy;
          ndy = -ray.dx;
        } else { // 90 or 270 degrees: "\" Mirror
          ndx = ray.dy;
          ndy = ray.dx;
        }
        
        queue.push({
          x: nextX,
          y: nextY,
          dx: ndx,
          dy: ndy,
          color: ray.color,
          points: [{ x: nextX, y: nextY }]
        });
      } 
      else if (tile.type === TYPE.SPLITTER) {
        this.beams.push(ray);
        totalSegments++;
        // ==========================================
        // SPLITTER TRUTH TABLE (HARDWARE SAFEGUARD)
        // ==========================================
        // Input: White Light (Red=1, Green=1, Blue=1)
        // Entry Dir: Must match prism flat face orientation
        // ------------------------------------------
        // Out1 (Left)     -> Receives Red (001)
        // Out2 (Straight) -> Receives Green (010)
        // Out3 (Right)    -> Receives Blue (100)
        // ------------------------------------------
        // Failsafe: Side hits -> High-Z (Blocked/Absorbed)
        // ==========================================
        
        let prismEntryDir = { x: 0, y: 0 };
        if (tile.angle === 0) prismEntryDir = DIR.RIGHT; // faces East, enters from West
        if (tile.angle === 90) prismEntryDir = DIR.DOWN; // faces South, enters from North
        if (tile.angle === 180) prismEntryDir = DIR.LEFT; // faces West, enters from East
        if (tile.angle === 270) prismEntryDir = DIR.UP; // faces North, enters from South
        
        if (ray.dx === prismEntryDir.x && ray.dy === prismEntryDir.y) {
          // Splitting logic
          const splitLeft = rotateDirCCW(prismEntryDir); // Left is CCW
          const splitRight = rotateDirCW(prismEntryDir); // Right is CW
          
          // Split Red component to the Left
          const redVal = ray.color & COLOR.RED;
          if (redVal > 0) {
            queue.push({
              x: nextX,
              y: nextY,
              dx: splitLeft.x,
              dy: splitLeft.y,
              color: redVal,
              points: [{ x: nextX, y: nextY }]
            });
          }
          
          // Split Green component Straight
          const greenVal = ray.color & COLOR.GREEN;
          if (greenVal > 0) {
            queue.push({
              x: nextX,
              y: nextY,
              dx: prismEntryDir.x,
              dy: prismEntryDir.y,
              color: greenVal,
              points: [{ x: nextX, y: nextY }]
            });
          }
          
          // Split Blue component to the Right
          const blueVal = ray.color & COLOR.BLUE;
          if (blueVal > 0) {
            queue.push({
              x: nextX,
              y: nextY,
              dx: splitRight.x,
              dy: splitRight.y,
              color: blueVal,
              points: [{ x: nextX, y: nextY }]
            });
          }
        } else {
          // Hits splitter from the side, blocks light (High-Z)
        }
      }
      else if (tile.type === TYPE.PORTAL) {
        this.beams.push(ray);
        totalSegments++;
        const portalId = tile.portalId || 1;
        
        // O(1) portal pairing via pre-built map (replaces O(n²) grid scan)
        const portals = this.portalMap.get(portalId);
        if (portals) {
          // Find the paired portal (the other one with the same ID)
          const paired = portals.find(p => !(p.x === nextX && p.y === nextY));
          if (paired) {
            queue.push({
              x: paired.x,
              y: paired.y,
              dx: ray.dx,
              dy: ray.dy,
              color: ray.color,
              points: [{ x: paired.x, y: paired.y }]
            });
            this.grid[paired.y][paired.x].incomingColor |= ray.color;
          }
        }
      }
      else if (tile.type === TYPE.FILTER) {
        const filteredColor = ray.color & (tile.color || COLOR.NONE);
        if (filteredColor > 0) {
          // FIX: Clone points array to prevent shared reference mutation.
          // Previously used `ray.points` directly, causing all child rays
          // to share and corrupt the same mutable array.
          queue.push({
            x: nextX,
            y: nextY,
            dx: ray.dx,
            dy: ray.dy,
            color: filteredColor,
            points: [...ray.points]
          });
        } else {
          this.beams.push(ray);
          totalSegments++;
        }
      }
      else {
        // EMPTY or EMITTER cell: continue straight.
        // FIX: Clone points array to prevent shared reference mutation.
        // The continuation ray extends the path — cloning ensures
        // independent arrays when beams split later.
        queue.push({
          x: nextX,
          y: nextY,
          dx: ray.dx,
          dy: ray.dy,
          color: ray.color,
          points: [...ray.points]
        });
      }
    }
    
    // Evaluate Receivers
    let allActive = true;
    this.receivers.forEach(recv => {
      const tile = this.grid[recv.y][recv.x];
      // A receiver is active if the exact target color is entering the cell
      recv.active = (tile.incomingColor === recv.targetColor);
      if (!recv.active) allActive = false;
    });
    
    // Check win condition
    if (allActive && this.receivers.length > 0 && !this.isWon) {
      this.isWon = true;
      synth.playWin();
      
      // Update narrative console
      this.triggerTypewriter("SYSTEM_CORE", "DECRYPTION COMPLETE. All security frequencies matched. Optical alignment stabilized.");
      
      // Trigger win overlay delay
      setTimeout(() => {
        const isCustom = (this.currentLevelIndex === 'custom');
        const nextBtn = document.getElementById('btn-next-level');
        const backBtn = document.getElementById('btn-back-to-editor');
        if (nextBtn) nextBtn.style.display = isCustom ? 'none' : 'block';
        if (backBtn) backBtn.style.display = isCustom ? 'block' : 'none';
        
        document.getElementById('win-overlay').classList.add('active');
      }, 1000);
    }
  }

  // ============================================================
  // --- Drift Clock System ---
  // Solstice Drift: unlocked driftable tiles rotate 90° CW every
  // `driftDuration` seconds. Tiles locked by beam contact are immune.
  // ============================================================

  /**
   * Update the drift timer and execute drift when threshold is reached.
   * @param {number} dt - Delta time in seconds since last frame
   */
  updateDrift(dt) {
    if (this.isWon || this.driftDuration <= 0) return;
    
    this.driftTimer += dt;
    if (this.driftTimer >= this.driftDuration) {
      this.driftTimer = 0;
      this.executeDrift();
    }
    
    // Update progress bar UI
    const fillPercent = (this.driftTimer / this.driftDuration) * 100;
    document.getElementById('drift-progress-fill').style.width = `${fillPercent}%`;
    
    const timeRemaining = Math.max(0, this.driftDuration - this.driftTimer);
    document.getElementById('drift-time-text').innerText = `${timeRemaining.toFixed(1)}s`;
  }

  /**
   * Execute a single drift tick: rotate all unlocked driftable tiles 90° CW.
   * Locked tiles (hit by a beam) are immune and reported to console.
   */
  executeDrift() {
    let mutated = false;
    const size = this.getGridSize();
    
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = this.grid[r][c];
        if (tile.driftable) {
          if (tile.locked) {
            // Locked by beam, write to console
            this.triggerTypewriter("SYSTEM_CORE", `Drift block [${c},${r}] locked by optical beam. Rotation suppressed.`);
          } else {
            // Unlocked, rotate by 90 degrees
            tile.angle = (tile.angle + 90) % 360;
            mutated = true;
          }
        }
      }
    }
    
    if (mutated) {
      synth.playDrift();
      this.triggerTypewriter("SYSTEM_CORE", "MAGNETIC FLUX DETECTED. Unstable nodes rotated.");
      this.updateBeams();
    }
  }

  // ============================================================
  // --- Console Typewriter Effect ---
  // ============================================================

  /**
   * Display a message in the narrative console with a typewriter animation.
   * Cancels any in-progress typewriter before starting a new one.
   * @param {string} speaker - Speaker identifier (e.g., "SYSTEM_CORE", "TURING_IMPRINT")
   * @param {string} message - Message text to type out
   */
  triggerTypewriter(speaker, message) {
    const consoleBox = document.getElementById('narrative-log');
    
    // Clear old text timeouts (prevents runaway recursion from rapid calls)
    if (this.typewriterTimeout) {
      clearTimeout(this.typewriterTimeout);
      this.typewriterTimeout = null;
    }
    
    // Create new elements
    const entry = document.createElement('div');
    entry.className = `narrative-entry ${speaker.toLowerCase()}`;
    
    const speakerSpan = document.createElement('div');
    speakerSpan.className = 'speaker';
    speakerSpan.innerText = `> [${speaker}]`;
    entry.appendChild(speakerSpan);
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'message console-cursor';
    entry.appendChild(msgSpan);
    
    consoleBox.appendChild(entry);
    
    // The scrolling container is the .panel-body parent of #narrative-log
    const scrollContainer = consoleBox.parentElement;
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    
    // Type letter by letter
    let charIndex = 0;
    const type = () => {
      if (charIndex < message.length) {
        msgSpan.innerText += message.charAt(charIndex);
        charIndex++;
        synth.playKeypress();
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
        this.typewriterTimeout = setTimeout(type, 20 + Math.random() * 20);
      } else {
        msgSpan.classList.remove('console-cursor');
        this.typewriterTimeout = null;
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };
    type();
  }

  // ============================================================
  // --- Canvas Rendering ---
  // Split into focused sub-methods for maintainability.
  // Uses shared `this.frameTime` instead of per-call Date.now().
  // ============================================================

  /**
   * Main draw entry point. Clears canvas and delegates to sub-renderers.
   * Uses `this.frameTime` for all animation calculations (set by game loop).
   */
  draw() {
    const ctx = this.ctx;
    // Use logical pixel dimensions (640×640) since we've applied DPR scaling
    ctx.clearRect(0, 0, 640, 640);
    
    const size = this.getGridSize();
    const totalGridWidth = size * this.cellSize;
    
    // Adjust offsets dynamically to center grid in Canvas
    this.gridOffset.x = (640 - totalGridWidth) / 2;
    this.gridOffset.y = (640 - totalGridWidth) / 2;
    
    this._drawGrid(ctx, size, totalGridWidth);
    this._drawHoverHighlight(ctx);
    this._drawBeams(ctx);
    this._drawTiles(ctx, size);
    this._drawSelectionCursor(ctx);
  }

  /**
   * Draw the blueprint-style background grid lines.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} size - Grid dimension
   * @param {number} totalGridWidth - Total grid width in pixels
   * @private
   */
  _drawGrid(ctx, size, totalGridWidth) {
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i++) {
      // Vertical grid line
      ctx.beginPath();
      ctx.moveTo(this.gridOffset.x + i * this.cellSize, this.gridOffset.y);
      ctx.lineTo(this.gridOffset.x + i * this.cellSize, this.gridOffset.y + totalGridWidth);
      ctx.stroke();
      
      // Horizontal grid line
      ctx.beginPath();
      ctx.moveTo(this.gridOffset.x, this.gridOffset.y + i * this.cellSize);
      ctx.lineTo(this.gridOffset.x + totalGridWidth, this.gridOffset.y + i * this.cellSize);
      ctx.stroke();
    }
  }

  /**
   * Draw the mouse hover highlight on the hovered grid cell.
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHoverHighlight(ctx) {
    if (!this.hoverTile) return;
    const { x, y } = this.gridToPixelTopLeft(this.hoverTile.x, this.hoverTile.y);
    ctx.fillStyle = 'rgba(0, 242, 254, 0.04)';
    ctx.fillRect(x + 4, y + 4, this.cellSize - 8, this.cellSize - 8);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4, y + 4, this.cellSize - 8, this.cellSize - 8);
  }

  /**
   * Draw all beam segments: first a colored glow pass, then animated flow dashes.
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBeams(ctx) {
    // First pass: solid glow backing
    ctx.lineCap = 'round';
    this.beams.forEach(beam => {
      if (beam.points.length < 2) return;
      ctx.strokeStyle = COLOR_MAP[beam.color];
      ctx.lineWidth = 6;
      ctx.shadowColor = COLOR_MAP[beam.color];
      ctx.shadowBlur = 12;
      
      ctx.beginPath();
      const start = this.gridToPixel(beam.points[0].x, beam.points[0].y);
      ctx.moveTo(start.x, start.y);
      
      for (let p = 1; p < beam.points.length; p++) {
        const pt = this.gridToPixel(beam.points[p].x, beam.points[p].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });
    
    // Second pass: animated flow dashes on top
    ctx.shadowBlur = 0; // Turn off shadow for performance
    const dashOffset = this.reducedMotion ? 0 : (this.frameTime / 30) % 40;
    this.beams.forEach(beam => {
      if (beam.points.length < 2) return;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 12]);
      ctx.lineDashOffset = -dashOffset; // Moves forward
      
      ctx.beginPath();
      const start = this.gridToPixel(beam.points[0].x, beam.points[0].y);
      ctx.moveTo(start.x, start.y);
      
      for (let p = 1; p < beam.points.length; p++) {
        const pt = this.gridToPixel(beam.points[p].x, beam.points[p].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]); // Reset
  }

  /**
   * Draw all grid tiles (components) with their visual representations.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} size - Grid dimension
   * @private
   */
  _drawTiles(ctx, size) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = this.grid[r][c];
        const { x: cellX, y: cellY } = this.gridToPixelTopLeft(c, r);
        
        // Draw tile overlay details
        if (tile.type !== TYPE.EMPTY) {
          // Draw tile backing container
          ctx.fillStyle = 'rgba(13, 22, 46, 0.6)';
          ctx.fillRect(cellX + 4, cellY + 4, this.cellSize - 8, this.cellSize - 8);
          
          ctx.strokeStyle = tile.rotatable ? 'rgba(0, 242, 254, 0.3)' : 'rgba(100, 116, 139, 0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(cellX + 4, cellY + 4, this.cellSize - 8, this.cellSize - 8);
        }
        
        // Render component by type
        ctx.save();
        ctx.translate(cellX + this.cellSize / 2, cellY + this.cellSize / 2);
        
        switch (tile.type) {
          case TYPE.WALL:
            this._drawWall(ctx);
            break;
          case TYPE.EMITTER:
            this._drawEmitter(ctx, tile);
            break;
          case TYPE.RECEIVER:
            this._drawReceiver(ctx, tile);
            break;
          case TYPE.MIRROR:
            this._drawMirror(ctx, tile);
            break;
          case TYPE.SPLITTER:
            this._drawSplitter(ctx, tile);
            break;
          case TYPE.PORTAL:
            this._drawPortal(ctx, tile);
            break;
          case TYPE.FILTER:
            this._drawFilter(ctx, tile);
            break;
        }
        
        ctx.restore();
      }
    }
  }

  /**
   * Draw a wall component (cross-hatched block).
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawWall(ctx) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-this.cellSize/2 + 8, -this.cellSize/2 + 8, this.cellSize - 16, this.cellSize - 16);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(-this.cellSize/2 + 8, -this.cellSize/2 + 8, this.cellSize - 16, this.cellSize - 16);
    
    // Draw cross hatch stripes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-15, -15); ctx.lineTo(15, 15);
    ctx.moveTo(-15, 15); ctx.lineTo(15, -15);
    ctx.stroke();
  }

  /**
   * Draw an emitter component (light source with pulsing glow).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawEmitter(ctx, tile) {
    // Rotate emitter to point in dir
    let emitterAngle = 0;
    if (isSameDir(tile.dir, DIR.DOWN)) emitterAngle = 90;
    if (isSameDir(tile.dir, DIR.LEFT)) emitterAngle = 180;
    if (isSameDir(tile.dir, DIR.UP)) emitterAngle = 270;
    ctx.rotate((emitterAngle * Math.PI) / 180);
    
    // Draw core casing
    ctx.fillStyle = '#334155';
    ctx.fillRect(-22, -14, 30, 28);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(-22, -14, 30, 28);
    
    // Emitter muzzle
    ctx.fillStyle = COLOR_MAP[tile.color];
    ctx.fillRect(8, -8, 8, 16);
    
    // Pulsing Glow indicator (respects reduced motion)
    const pulse = this.reducedMotion ? 0 : Math.sin(this.frameTime / 150) * 2;
    ctx.shadowColor = COLOR_MAP[tile.color];
    ctx.shadowBlur = 8 + pulse;
    ctx.fillStyle = COLOR_MAP[tile.color];
    ctx.beginPath();
    ctx.arc(-8, 0, 6 + pulse/2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw a receiver component (target ring with activation state).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawReceiver(ctx, tile) {
    // Draw receiver ring
    ctx.strokeStyle = COLOR_MAP[tile.color];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner core status
    if (tile.incomingColor === tile.color) {
      const pulse = this.reducedMotion ? 0 : Math.sin(this.frameTime / 100) * 3;
      ctx.shadowColor = COLOR_MAP[tile.color];
      ctx.shadowBlur = 12 + pulse;
      ctx.fillStyle = COLOR_MAP[tile.color];
      ctx.beginPath();
      ctx.arc(0, 0, 10 + pulse/3, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw rotating locks (respects reduced motion)
      ctx.save();
      const lockRotation = this.reducedMotion ? 0 : (this.frameTime / 300) % (Math.PI * 2);
      ctx.rotate(lockRotation);
      ctx.strokeStyle = COLOR_MAP[tile.color];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 24, Math.PI, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(100, 116, 139, 0.15)';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw a dimmer outline if another color hits it (helps debugging logic)
      if (tile.incomingColor !== COLOR.NONE) {
        ctx.strokeStyle = COLOR_MAP[tile.incomingColor];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    
    // Direction indicator notch
    let notchAngle = 0;
    if (isSameDir(tile.dir, DIR.DOWN)) notchAngle = 90;
    if (isSameDir(tile.dir, DIR.LEFT)) notchAngle = 180;
    if (isSameDir(tile.dir, DIR.UP)) notchAngle = 270;
    ctx.rotate((notchAngle * Math.PI) / 180);
    
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-22, -2, 6, 4);
  }

  /**
   * Draw a mirror component (diagonal blade with optional drift indicators).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawMirror(ctx, tile) {
    // Apply smooth visual rotation
    const visualAng = tile.visualAngle !== undefined ? tile.visualAngle : tile.angle;
    ctx.rotate((visualAng * Math.PI) / 180);
    
    // Draw Mirror Blade diagonal line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-18, 18);
    ctx.lineTo(18, -18);
    ctx.stroke();
    
    // Shiny glass overlay
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 14);
    ctx.lineTo(14, -14);
    ctx.stroke();
    
    // Draw rotation mount center
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Driftable indicators
    if (tile.driftable) {
      ctx.strokeStyle = tile.locked ? '#33ff66' : '#ff5e00';
      ctx.lineWidth = 2;
      
      // Pulse circle if unlocked/drifting (respects reduced motion)
      if (!tile.locked && !this.reducedMotion) {
        const pulse = (this.frameTime / 200) % 6;
        ctx.strokeStyle = `rgba(255, 94, 0, ${1 - pulse/6})`;
        ctx.beginPath();
        ctx.arc(0, 0, 18 + pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Outer bracket indicator
      ctx.strokeStyle = tile.locked ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 94, 0, 0.6)';
      ctx.strokeRect(-this.cellSize/2 + 7, -this.cellSize/2 + 7, this.cellSize - 14, this.cellSize - 14);

      if (tile.locked) {
        // Draw a small padlock indicator
        ctx.fillStyle = '#39ff14';
        ctx.fillRect(-4, -15, 8, 6);
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, -15, 3, Math.PI, 0);
        ctx.stroke();
      }
    }
  }

  /**
   * Draw a splitter/prism component (triangle with rainbow core).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawSplitter(ctx, tile) {
    // Apply smooth visual rotation
    const visualAng = tile.visualAngle !== undefined ? tile.visualAngle : tile.angle;
    ctx.rotate((visualAng * Math.PI) / 180);
    
    // Draw Prism Triangle
    ctx.fillStyle = 'rgba(0, 242, 254, 0.15)';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(-15, -15);
    ctx.lineTo(-15, 15);
    ctx.lineTo(15, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Draw rainbow core stripe
    ctx.fillStyle = '#ff3366';
    ctx.fillRect(-10, -8, 3, 16);
    ctx.fillStyle = '#33ff66';
    ctx.fillRect(-7, -8, 3, 16);
    ctx.fillStyle = '#3366ff';
    ctx.fillRect(-4, -8, 3, 16);
  }

  /**
   * Draw a portal component (rotating dashed ring with channel label).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawPortal(ctx, tile) {
    const pColorMap = {
      1: { outer: '#9d00ff', inner: '#00f2fe' },
      2: { outer: '#ff5e00', inner: '#ffff33' },
      3: { outer: '#39ff14', inner: '#33ffff' }
    };
    const pColors = pColorMap[tile.portalId || 1] || pColorMap[1];
    const hasLight = (tile.incomingColor !== COLOR.NONE);
    
    ctx.strokeStyle = pColors.outer;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = pColors.outer;
    ctx.shadowBlur = hasLight ? 12 : 0;
    
    ctx.save();
    const portalRotation = this.reducedMotion ? 0 : (this.frameTime / 250) % (Math.PI * 2);
    ctx.rotate(portalRotation);
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    
    ctx.fillStyle = hasLight ? pColors.inner : 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    
    // Write portal ID letters (A, B, C)
    // FIX: Use resolved font constant instead of var(--font-mono) which Canvas can't resolve
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 10px ${CANVAS_FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = { 1: 'A', 2: 'B', 3: 'C' };
    ctx.fillText(letters[tile.portalId || 1] || 'A', 0, 0);
  }

  /**
   * Draw a filter component (colored sieve box).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Tile} tile
   * @private
   */
  _drawFilter(ctx, tile) {
    const fColor = COLOR_MAP[tile.color];
    const rgb = COLOR_RGB_MAP[tile.color] || '255, 255, 255';
    const hasLight = (tile.incomingColor !== COLOR.NONE);
    
    ctx.fillStyle = hasLight ? `rgba(${rgb}, 0.28)` : `rgba(${rgb}, 0.08)`;
    ctx.strokeStyle = fColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = hasLight ? 10 : 0;
    
    ctx.beginPath();
    ctx.rect(-18, -18, 36, 36);
    ctx.fill();
    ctx.stroke();
    
    // Draw sieve grid inside
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${rgb}, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(-18, 0); ctx.lineTo(18, 0);
    ctx.moveTo(0, -18); ctx.lineTo(0, 18);
    ctx.stroke();
  }

  /**
   * Draw the keyboard selection cursor (corner bracket target lock).
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawSelectionCursor(ctx) {
    if (document.activeElement !== this.canvas || !this.selectedTile) return;
    
    const { x, y } = this.gridToPixelTopLeft(this.selectedTile.x, this.selectedTile.y);
    
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 10;
    
    // Draw corners of the selection box to look like a target lock
    const len = 15;
    ctx.beginPath();
    // Top Left
    ctx.moveTo(x + 2, y + 2 + len);
    ctx.lineTo(x + 2, y + 2);
    ctx.lineTo(x + 2 + len, y + 2);
    
    // Top Right
    ctx.moveTo(x + this.cellSize - 2 - len, y + 2);
    ctx.lineTo(x + this.cellSize - 2, y + 2);
    ctx.lineTo(x + this.cellSize - 2, y + 2 + len);
    
    // Bottom Right
    ctx.moveTo(x + this.cellSize - 2, y + this.cellSize - 2 - len);
    ctx.lineTo(x + this.cellSize - 2, y + this.cellSize - 2);
    ctx.lineTo(x + this.cellSize - 2 - len, y + this.cellSize - 2);
    
    // Bottom Left
    ctx.moveTo(x + 2 + len, y + this.cellSize - 2);
    ctx.lineTo(x + 2, y + this.cellSize - 2);
    ctx.lineTo(x + 2, y + this.cellSize - 2 - len);
    
    ctx.stroke();
    ctx.shadowBlur = 0; // reset shadow
  }

  // ============================================================
  // --- Visual Angle Interpolation ---
  // Smooth rotation animation for mirrors and splitters.
  // ============================================================

  /**
   * Interpolate visual angles toward target angles for smooth rotation rendering.
   * Uses lerp with shortest-path wrapping around 360°.
   */
  updateVisualAngles() {
    const size = this.getGridSize();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = this.grid[r][c];
        if (tile.visualAngle === undefined) {
          tile.visualAngle = tile.angle || 0;
        }
        
        let diff = tile.angle - tile.visualAngle;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        
        if (Math.abs(diff) < 0.2) {
          tile.visualAngle = tile.angle;
        } else {
          tile.visualAngle += diff * 0.25; // Smooth interpolation lerp
        }
      }
    }
  }

  // ============================================================
  // --- Main Engine Loop ---
  // ============================================================

  /**
   * Main game loop driven by requestAnimationFrame.
   * Computes delta-time, updates drift/animations, and renders.
   * @param {DOMHighResTimeStamp} timestamp - Frame timestamp from rAF
   */
  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    
    // Store frame timestamp for animation calculations (replaces Date.now() per frame)
    this.frameTime = timestamp;
    
    // Update and Render
    this.updateDrift(dt);
    this.updateVisualAngles();
    this.draw();
    
    // Loop
    requestAnimationFrame((t) => this.loop(t));
  }
}

// ============================================================
// --- Initialization ---
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
  // Set thematic system date to the June Solstice
  const dateEl = document.getElementById('sys-date');
  if (dateEl) dateEl.innerText = `SYS_DATE: 2026.06.21`;

  const game = new SolsticeGame();
  
  // Guard against missing canvas (constructor sets this.canvas = null on error)
  if (!game.canvas || !game.ctx) {
    console.error('SolsticeGame: Failed to initialize. Ensure #game-canvas exists.');
    return;
  }
  
  game.loadLevel(0);
  
  // Start loop
  requestAnimationFrame((t) => game.loop(t));
});
