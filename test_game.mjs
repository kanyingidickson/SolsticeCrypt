/**
 * Solstice Crypt — Test Suite
 * Uses Node.js native test runner (node:test) and assert (node:assert) to verify:
 * - Direction rotation and resolution helpers
 * - Color bitwise logic
 * - Solvability of all 8 sectors
 * - Infinite loop safety (facing mirrors)
 * - Drift system functionality (unlocked vs. locked)
 * - Optic Portals teleportation and Wavelength Filters masking
 * - Edge cases: absorption, side-hits, unpaired portals, multiple beam mixing
 * - Render loop smoke tests
 * - Editor roundtrip export/import accuracy
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';

// Minimal DOM stubs so game.js can load in headless Node environment
class FakeElement {
  constructor() {
    this.style = {};
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    };
    this.innerText = '';
    this.innerHTML = '';
    this.value = '0';
    this.checked = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.className = '';
  }
  addEventListener() {}
  appendChild() {}
  setAttribute() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 640 }; }
  getContext() {
    return {
      clearRect() {}, fillRect() {}, strokeRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {},
      fill() {}, stroke() {}, scale() {}, rect() {},
      setLineDash() {}, getLineDash() { return []; },
      save() {}, restore() {}, translate() {}, rotate() {},
      set fillStyle(v) {}, get fillStyle() { return ''; },
      set strokeStyle(v) {}, get strokeStyle() { return ''; },
      set lineWidth(v) {}, set lineCap(v) {},
      set shadowColor(v) {}, set shadowBlur(v) {},
      fillText() {}, measureText() { return { width: 10 }; }
    };
  }
}

const elementsCache = new Map();
globalThis.document = {
  getElementById: (id) => {
    if (!elementsCache.has(id)) {
      elementsCache.set(id, new FakeElement());
    }
    return elementsCache.get(id);
  },
  createElement: () => new FakeElement(),
};

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  AudioContext: class {
    createOscillator() {
      return {
        connect() {},
        start() {},
        stop() {},
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
          linearRampToValueAtTime() {}
        }
      };
    }
    createGain() {
      return {
        connect() {},
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
          linearRampToValueAtTime() {}
        }
      };
    }
    createBiquadFilter() {
      return {
        connect() {},
        frequency: {
          setValueAtTime() {},
          connect() {}
        }
      };
    }
    get currentTime() { return 0; }
    get destination() { return {}; }
  },
  webkitAudioContext: class {},
};

globalThis.navigator = {
  clipboard: {
    writeText: async () => {},
    readText: async () => ''
  }
};

globalThis.requestAnimationFrame = () => {};
globalThis.Date = Date;

// ---- Import game constants and classes by reading game.js ----
const code = readFileSync('./game.js', 'utf-8');

// Strip the DOMContentLoaded listener block at the bottom
const modifiedCode = code
  .replace(/window\.addEventListener\('DOMContentLoaded'[\s\S]*$/, '')
  .replace(/^export\s/gm, '');

const fn = new Function('document', 'window', 'requestAnimationFrame', 'Date', `
  ${modifiedCode}
  return { COLOR, TYPE, DIR, LEVELS, SolsticeGame, isSameDir, rotateDirCW, rotateDirCCW, resolveDirection, MAX_BEAM_SEGMENTS };
`);

const {
  COLOR, TYPE, DIR, LEVELS, SolsticeGame,
  isSameDir, rotateDirCW, rotateDirCCW, resolveDirection,
  MAX_BEAM_SEGMENTS
} = fn(globalThis.document, globalThis.window, globalThis.requestAnimationFrame, Date);


// --- TEST 1: Direction Helpers ---
test('Direction rotation and resolution helpers', () => {
  assert.strictEqual(isSameDir(rotateDirCW(DIR.UP), DIR.RIGHT), true);
  assert.strictEqual(isSameDir(rotateDirCW(DIR.RIGHT), DIR.DOWN), true);
  assert.strictEqual(isSameDir(rotateDirCW(DIR.DOWN), DIR.LEFT), true);
  assert.strictEqual(isSameDir(rotateDirCW(DIR.LEFT), DIR.UP), true);

  assert.strictEqual(isSameDir(rotateDirCCW(DIR.UP), DIR.LEFT), true);
  assert.strictEqual(isSameDir(rotateDirCCW(DIR.LEFT), DIR.DOWN), true);
  assert.strictEqual(isSameDir(rotateDirCCW(DIR.DOWN), DIR.RIGHT), true);
  assert.strictEqual(isSameDir(rotateDirCCW(DIR.RIGHT), DIR.UP), true);

  assert.deepStrictEqual(resolveDirection('UP'), DIR.UP);
  assert.deepStrictEqual(resolveDirection(DIR.UP), DIR.UP);
  assert.strictEqual(resolveDirection(null), null);
  assert.strictEqual(resolveDirection(undefined), null);
});


// --- TEST 2: Color Bitwise Logic ---
test('Bitwise color composition', () => {
  assert.strictEqual(COLOR.RED | COLOR.BLUE, COLOR.MAGENTA);
  assert.strictEqual(COLOR.RED | COLOR.GREEN, COLOR.YELLOW);
  assert.strictEqual(COLOR.GREEN | COLOR.BLUE, COLOR.CYAN);
  assert.strictEqual(COLOR.RED | COLOR.GREEN | COLOR.BLUE, COLOR.WHITE);
  assert.strictEqual(COLOR.RED | COLOR.RED, COLOR.RED); // idempotent
});


// --- TEST 3: Level Solvability ---
test('Level solvability check (brute force all 8 levels)', () => {
  const game = new SolsticeGame();
  
  for (let lvlIdx = 0; lvlIdx < LEVELS.length; lvlIdx++) {
    const lvl = LEVELS[lvlIdx];
    game.loadLevel(lvlIdx);
    
    const rotatables = [];
    const size = lvl.gridSize;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (game.grid[r][c].rotatable) {
          rotatables.push({ x: c, y: r });
        }
      }
    }
    
    const numRotatables = rotatables.length;
    const totalCombos = Math.pow(4, numRotatables);
    let solved = false;
    
    for (let combo = 0; combo < totalCombos; combo++) {
      game.loadLevel(lvlIdx);
      let bits = combo;
      for (let i = 0; i < numRotatables; i++) {
        const { x, y } = rotatables[i];
        const rotations = bits % 4;
        bits = Math.floor(bits / 4);
        game.grid[y][x].angle = rotations * 90;
      }
      
      game.updateBeams();
      
      let allActive = true;
      for (const recv of game.receivers) {
        const tile = game.grid[recv.y][recv.x];
        if (tile.incomingColor !== recv.targetColor) {
          allActive = false;
          break;
        }
      }
      
      if (allActive && game.receivers.length > 0) {
        solved = true;
        break;
      }
    }
    
    assert.strictEqual(solved, true, `Level ${lvlIdx + 1}: ${lvl.name} is unsolvable!`);
  }
});


// --- TEST 4: Infinite Loop Protection ---
test('Infinite loop protection', () => {
  const game = new SolsticeGame();
  game.loadLevel(0);
  // Set up two mirrors facing each other directly to cause an infinite loop bounce
  game.grid[1][3].angle = 90;
  game.grid[1][4] = {
    type: TYPE.MIRROR,
    angle: 270,
    rotatable: false,
    driftable: false,
    color: COLOR.NONE,
    dir: null,
    locked: false,
    incomingColor: COLOR.NONE,
    portalId: 1
  };
  
  const startTime = Date.now();
  game.updateBeams();
  const elapsed = Date.now() - startTime;
  
  assert.ok(elapsed < 200, `Beam calculation took too long (${elapsed}ms)`);
  assert.ok(game.beams.length > 0, 'No beams generated');
});


// --- TEST 5: Drift System Behavior ---
test('Drift system behavior', () => {
  const game = new SolsticeGame();
  game.loadLevel(3); // Level 4 has drifting mirrors
  
  const driftTiles = [];
  for (let r = 0; r < LEVELS[3].gridSize; r++) {
    for (let c = 0; c < LEVELS[3].gridSize; c++) {
      if (game.grid[r][c].driftable) {
        driftTiles.push({ x: c, y: r });
      }
    }
  }
  
  assert.ok(driftTiles.length > 0, 'Level 4 should contain driftable mirrors');
  
  // Unlocked drift test
  const dt = driftTiles[0];
  const angleBefore = game.grid[dt.y][dt.x].angle;
  game.grid[dt.y][dt.x].locked = false;
  game.executeDrift();
  const angleAfter = game.grid[dt.y][dt.x].angle;
  assert.strictEqual(angleAfter, (angleBefore + 90) % 360, 'Unlocked drift failed to rotate mirror');
  
  // Locked drift test
  game.loadLevel(3);
  const dt2 = driftTiles[0];
  const angleBefore2 = game.grid[dt2.y][dt2.x].angle;
  game.grid[dt2.y][dt2.x].locked = true;
  game.executeDrift();
  const angleAfter2 = game.grid[dt2.y][dt2.x].angle;
  assert.strictEqual(angleAfter2, angleBefore2, 'Locked drift rotated mirror despite light beam lock');
});


// --- TEST 6: Optic Portals Logic ---
test('Optic Portals logic', () => {
  const game = new SolsticeGame();
  game.loadLevel(5); // Level 6 has portals
  game.updateBeams();
  
  const portalA1 = game.grid[2][2];
  const portalA2 = game.grid[1][4];
  
  assert.ok(portalA1.incomingColor > 0, 'Portal A1 should receive light');
  assert.ok(portalA2.incomingColor > 0, 'Portal A2 should receive light');
});


// --- TEST 7: Wavelength Filters Logic ---
test('Wavelength Filters logic', () => {
  const game = new SolsticeGame();
  game.loadLevel(6); // Level 7 has filters
  game.updateBeams();
  
  const filterNext = game.grid[1][3];
  assert.strictEqual(filterNext.incomingColor, COLOR.YELLOW, 'Yellow filter output should be Yellow');
});


// --- TEST 8: Edge Cases ---
test('Edge Case: Beam through filter with no matching color is absorbed', () => {
  const game = new SolsticeGame();
  game.customLevel = {
    name: "Filter Absorption Test",
    quote: "",
    gridSize: 5,
    driftDuration: 0,
    grid: [
      { x: 0, y: 2, type: TYPE.EMITTER, color: COLOR.BLUE, dir: DIR.RIGHT },
      { x: 2, y: 2, type: TYPE.FILTER, color: COLOR.RED } // Red filter blocks blue light
    ]
  };
  game.loadLevel('custom');
  game.updateBeams();
  
  // Cell at 3,2 (past the filter) should have incomingColor = NONE
  assert.strictEqual(game.grid[2][3].incomingColor, COLOR.NONE, 'Blue light should be absorbed by red filter');
});

test('Edge Case: Beam hitting splitter from the side is blocked', () => {
  const game = new SolsticeGame();
  game.customLevel = {
    name: "Splitter Side-Hit Test",
    quote: "",
    gridSize: 5,
    driftDuration: 0,
    grid: [
      { x: 2, y: 0, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.DOWN },
      { x: 2, y: 2, type: TYPE.SPLITTER, angle: 0, rotatable: false } // Facing RIGHT (East). Hit from North.
    ]
  };
  game.loadLevel('custom');
  game.updateBeams();
  
  // Below the splitter (cell 2,3) should have incomingColor = NONE
  assert.strictEqual(game.grid[3][2].incomingColor, COLOR.NONE, 'Splitter should block beams hitting its side');
});

test('Edge Case: Portal with no pair terminates beam gracefully', () => {
  const game = new SolsticeGame();
  game.customLevel = {
    name: "Single Portal Test",
    quote: "",
    gridSize: 5,
    driftDuration: 0,
    grid: [
      { x: 0, y: 2, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 2, y: 2, type: TYPE.PORTAL, portalId: 1 } // No portal pair
    ]
  };
  game.loadLevel('custom');
  game.updateBeams();
  
  assert.strictEqual(game.portalMap.get(1).length, 1, 'Only one portal should be mapped');
  assert.ok(game.beams.length > 0, 'Simulation should proceed without error');
  // Beam should not propagate past portal
  assert.strictEqual(game.grid[2][3].incomingColor, COLOR.NONE, 'Beam should terminate at unpaired portal');
});

test('Edge Case: Multiple beams hitting same receiver (color OR composition)', () => {
  const game = new SolsticeGame();
  game.customLevel = {
    name: "Receiver Color OR Mix Test",
    quote: "",
    gridSize: 5,
    driftDuration: 0,
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.RED, dir: DIR.RIGHT },
      { x: 0, y: 3, type: TYPE.EMITTER, color: COLOR.BLUE, dir: DIR.RIGHT },
      { x: 4, y: 1, type: TYPE.MIRROR, angle: 90, rotatable: false },  // reflects Red down (\ mirror)
      { x: 4, y: 3, type: TYPE.MIRROR, angle: 0, rotatable: false },   // reflects Blue up (/ mirror)
      { x: 4, y: 2, type: TYPE.RECEIVER, color: COLOR.MAGENTA, dir: DIR.LEFT }
    ]
  };
  game.loadLevel('custom');
  game.updateBeams();
  
  const recv = game.receivers[0];
  assert.strictEqual(game.grid[2][4].incomingColor, COLOR.RED | COLOR.BLUE, 'Color should mix to Magenta');
  assert.strictEqual(recv.active, true, 'Receiver should activate on correctly mixed colors');
});

test('Edge Case: Max beam segment cap prevents infinite loops on circular layouts', () => {
  const game = new SolsticeGame();
  // Set up 4 mirrors in a circle to loop light infinitely
  game.customLevel = {
    name: "Infinite Mirror Loop",
    quote: "",
    gridSize: 5,
    driftDuration: 0,
    grid: [
      { x: 0, y: 0, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT },
      { x: 2, y: 0, type: TYPE.MIRROR, angle: 90, rotatable: false }, // reflects DOWN
      { x: 2, y: 2, type: TYPE.MIRROR, angle: 0, rotatable: false },  // reflects LEFT
      { x: 0, y: 2, type: TYPE.MIRROR, angle: 90, rotatable: false }, // reflects UP
      { x: 0, y: 0, type: TYPE.MIRROR, angle: 0, rotatable: false }   // reflects RIGHT
    ]
  };
  game.loadLevel('custom');
  game.updateBeams();
  
  assert.ok(game.beams.length <= MAX_BEAM_SEGMENTS, `Beams count ${game.beams.length} exceeded safety cap ${MAX_BEAM_SEGMENTS}`);
});

test('Edge Case: Invalid custom level import fails gracefully', () => {
  const game = new SolsticeGame();
  
  game.customLevel = {
    name: "Valid Initial Level",
    quote: "",
    gridSize: 6,
    driftDuration: 0,
    grid: []
  };
  
  // Try importing a corrupted string
  game.importCustomCode("not-base64!");
  assert.strictEqual(game.customLevel.name, "Valid Initial Level", "Custom level should remain unchanged on corrupt base64");
  
  // Try importing invalid JSON
  game.importCustomCode("aW52YWxpZC1qc29u"); // Decodes to "invalid-json"
  assert.strictEqual(game.customLevel.name, "Valid Initial Level", "Custom level should remain unchanged on corrupt JSON");

  // Try importing grid size out of bounds (99)
  const codeStr = btoa(JSON.stringify({ name: "Bad Size", gridSize: 99, grid: [] }));
  game.importCustomCode(codeStr);
  assert.strictEqual(game.customLevel.name, "Valid Initial Level", "Custom level should remain unchanged on grid size out of bounds");
});


// --- TEST 9: Render/Drawing Smoke Tests ---
test('Render/drawing smoke tests', () => {
  const game = new SolsticeGame();
  
  // Test draw() on all levels
  for (let lvlIdx = 0; lvlIdx < LEVELS.length; lvlIdx++) {
    game.loadLevel(lvlIdx);
    game.updateBeams();
    assert.doesNotThrow(() => game.draw(), `draw() threw an error on level ${lvlIdx + 1}`);
  }
  
  // Test draw() on empty grid
  game.customLevel = {
    name: "Empty",
    quote: "",
    gridSize: 6,
    driftDuration: 0,
    grid: []
  };
  game.loadLevel('custom');
  assert.doesNotThrow(() => game.draw(), 'draw() threw an error on an empty custom grid');
  
  // Test draw() after level victory
  game.loadLevel(0);
  
  const smokeRotatables = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      if (game.grid[r][c].rotatable) {
        smokeRotatables.push({ x: c, y: r });
      }
    }
  }
  for (let combo = 0; combo < 16; combo++) {
    let bits = combo;
    for (let i = 0; i < smokeRotatables.length; i++) {
      const { x, y } = smokeRotatables[i];
      const rotations = bits % 4;
      bits = Math.floor(bits / 4);
      game.grid[y][x].angle = rotations * 90;
    }
    game.updateBeams();
    if (game.isWon) break;
  }
  
  assert.strictEqual(game.isWon, true, 'Level 1 did not reach won state');
  assert.doesNotThrow(() => game.draw(), 'draw() threw an error after level win');
});


// --- TEST 10: Editor Roundtrip Tests ---
test('Editor roundtrip tests (export / import consistency)', () => {
  const game = new SolsticeGame();
  
  game.customLevel = {
    name: "Roundtrip Test Level",
    quote: "Testing export and import parity",
    gridSize: 5,
    driftDuration: 8,
    grid: [
      { x: 0, y: 1, type: TYPE.EMITTER, color: COLOR.WHITE, dir: DIR.RIGHT, rotatable: false, driftable: false, angle: 0, portalId: 1 },
      { x: 2, y: 1, type: TYPE.MIRROR, color: COLOR.NONE, dir: null, rotatable: true, driftable: true, angle: 90, portalId: 1 },
      { x: 4, y: 4, type: TYPE.RECEIVER, color: COLOR.WHITE, dir: DIR.LEFT, rotatable: false, driftable: false, angle: 0, portalId: 1 }
    ]
  };
  game.loadLevel('custom');
  
  const codeStr = game.exportCustomCode();
  assert.ok(codeStr.length > 0, 'Exported code should be a non-empty string');
  
  const game2 = new SolsticeGame();
  game2.importCustomCode(codeStr);
  
  assert.strictEqual(game2.customLevel.name, "Roundtrip Test Level");
  assert.strictEqual(game2.customLevel.gridSize, 5);
  assert.strictEqual(game2.customLevel.driftDuration, 8);
  assert.strictEqual(game2.customLevel.grid.length, 3);
  
  const originalSorted = [...game.customLevel.grid].sort((a, b) => a.x - b.x || a.y - b.y);
  const importedSorted = [...game2.customLevel.grid].sort((a, b) => a.x - b.x || a.y - b.y);
  
  for (let i = 0; i < originalSorted.length; i++) {
    const orig = originalSorted[i];
    const imp = importedSorted[i];
    
    assert.strictEqual(orig.x, imp.x);
    assert.strictEqual(orig.y, imp.y);
    assert.strictEqual(orig.type, imp.type);
    assert.strictEqual(orig.color, imp.color);
    assert.strictEqual(orig.angle, imp.angle);
    assert.strictEqual(orig.rotatable, imp.rotatable);
    assert.strictEqual(orig.driftable, imp.driftable);
    assert.strictEqual(orig.portalId, imp.portalId);
  }
});
