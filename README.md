# 🌞 Solstice Crypt - Decrypt the Light 🏳️‍🌈

**Solstice Crypt** is a real-time, responsive optical decryption puzzle game built entirely in vanilla HTML5, CSS3, and JavaScript (ES Modules) with **zero dependencies**. The game is played inside a retro-futuristic terminal UI with gorgeous glassmorphic styling, glowing laser beams, CRT scanlines, and real-time audio synthesized procedurally using the Web Audio API.

> Route and split colored light beams through a grid - using mirrors, prisms, portals, and filters - to match receiver requirements before the system drifts.

---

## 🎮 Play the Game

- **GitHub Repository:** *[https://github.com/kanyingidickson/SolsticeCrypt](https://github.com/kanyingidickson/SolsticeCrypt)*
- **Live URL:** *[https://kanyingidickson.github.io/SolsticeCrypt](https://kanyingidickson.github.io/SolsticeCrypt)*


---

## 🧠 Core Gameplay Mechanics

1. **Optical Routing (Rotate Verb):** Click or tap any highlighted grid tile to rotate it 90 degrees clockwise. This changes the direction of mirrors and splitter prisms.
2. **Color Decomposition (RGB Prisms):** Guide white light into a prism to split it into its component wavelengths: **Red**, **Green**, and **Blue**.
3. **Additive Color Synthesis:** Combine different colored light beams into a single receiver node to synthesize secondary colors:
   - 🔴 Red + 🔵 Blue = 🟣 **Magenta**
   - 🔴 Red + 🟢 Green = 🟡 **Yellow**
   - 🟢 Green + 🔵 Blue = 🔵 **Cyan**
   - 🔴 Red + 🟢 Green + 🔵 Blue = ⚪ **White**
4. **Solstice Drift & Optical Lock:** Watch out for the orange, unstable mirror nodes. They will rotate automatically when the countdown reaches zero unless stabilized! 
   - **Optical Lock:** Directing any active light beam through a drifting mirror node secures it with an **Optical Lock** (indicated by a green padlock and glowing green frame), suppressing the drift.
5. **Optic Portals:** Paired portal nodes teleport light beams across the grid. Portals sharing the same channel (Alpha, Beta, or Gamma) create a quantum tunnel for beams to traverse instantly.
6. **Wavelength Filters:** Filter nodes selectively pass only the matching color wavelength, absorbing all other frequencies. Use them to isolate specific color components from mixed beams.

---

## ⚙️ Technical Highlights

- **Deterministic Raycasting Engine:** Built with an iterative Breadth-First Search (BFS) queue for ray propagation. A visited set tracking `(x, y, dx, dy, color)` provides a mathematical guarantee against infinite loops (e.g. facing mirrors).
- **Bitwise Color Mixing:** Colors are modeled using 3-bit flags (`RED=1`, `GREEN=2`, `BLUE=4`), allowing all color addition/combination logic to be solved via extremely fast bitwise OR operations.
- **Procedural Synthesizer:** Fully synth-driven audio using the HTML5 Web Audio API. Short square-wave click transitions for tiles, randomized triangle-wave pips for the console typewriter, sawtooth sweeps for warnings, and a C-major arpeggio win chime. Background ambient music plays by default.
- **High-Z Absorbers:** Prisms/Splitters enforce exact direction alignment. Misaligned side-entry light is absorbed (High-Z impedance) to prevent invalid pathing.
- **CRT terminal styling:** Rich glassmorphism with high-contrast neon styling, custom typing font interfaces, scanlines, and warning tickers.
- **Creative Lab (Level Editor):** A built-in level designer with all 8 element types, share codes for exporting/importing puzzles via Base64 cipher strings, and a built-in guide with a demo puzzle.

---

## 🚀 Local Development Setup

To run the game locally, you will need [Node.js](https://nodejs.org/) installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kanyingidickson/SolsticeCrypt.git
   cd SolsticeCrpty
   ```

2. **Install development dependencies:**
   ```bash
   npm install
   ```

3. **Run the Vite development server:**
   ```bash
   npm run dev
   ```
   Open the address shown in your console (typically `http://localhost:5173`).

4. **Run automated test suite:**
   To verify the game engine, color composition, portal/filter logic, and all 8 levels' solvability:
   ```bash
   node test_game.mjs
   ```

5. **Build for production:**
   To generate optimized, static HTML/JS/CSS assets:
   ```bash
   npm run build
   ```
   The built assets will be placed in the `dist/` directory.

---

## 🎨 Level Design

The game contains **8 sectors** plus a **Creative Lab**, each introducing core concepts step-by-step:

| Sector | Name | Mechanic Introduced |
| :--- | :--- | :--- |
| 01 | **Solstice Dawn** | Mirror rotation and white laser routing |
| 02 | **Turing's Prism** | Prisms and color splitting (RGB) |
| 03 | **Pride Synthesis** | Additive color combining (Magenta) |
| 04 | **Solstice Drift** | Unstable drift nodes and the Optical Lock |
| 05 | **Crypt-Breaker** | Mastery test combining all core mechanics |
| 06 | **Quantum Tunnel** | Optic Portals for beam teleportation |
| 07 | **Spectral Sieve** | Wavelength Filters for color isolation |
| 08 | **The Grand Solstice** | Final mastery: all mechanics on an 8×8 grid |
| 🛠 | **Creative Lab** | Design, test, and share your own puzzles |

---

## 🛠 Creative Lab

After completing all 8 sectors (or by selecting it from the SECTOR dropdown), the **Creative Lab** unlocks a full level editor:

- **Design Mode:** Place any of the 8 element types (Emitter, Mirror, Splitter, Receiver, Wall, Portal, Filter, Empty) on a 6×6 grid.
- **Play Mode:** Toggle to test your puzzle in real-time with the full raycasting engine.
- **Share Codes:** Your level is automatically encoded as a Base64 cipher string. Copy it and share with other players!
- **Import:** Paste a friend's cipher code and click **IMPORT CODE** to load their puzzle.
- **Built-in Guide:** An expandable help panel with quick-start steps, element reference table, and a pre-loaded "Quantum Gateway" demo puzzle.

### Demo Puzzle Code (Quantum Gateway)
Try pasting this code into the Creative Lab's SHARE CODE box and clicking IMPORT:
```
eyJuYW1lIjoiUXVhbnR1bSBHYXRld2F5IiwicXVvdGUiOiJERU1PIFBVWlpMRTogUGFzcyB3aGl0ZSBsaWdodCB0aHJvdWdoIGEgWWVsbG93IGZpbHRlciwgdGhlbiByb3V0ZSBpdCBpbnRvIHRoZSBBbHBoYSBwb3J0YWwgdG8gdGVsZXBvcnQgaXQgYWNyb3NzIHRoZSBncmlkIHRvIHRoZSByZWNlaXZlci4iLCJncmlkU2l6ZSI6NiwiZHJpZnREdXJhdGlvbiI6MCwiZ3JpZCI6W3sieCI6MCwieSI6MCwidHlwZSI6ImVtaXR0ZXIiLCJhbmdsZSI6MCwicm90YXRhYmxlIjpmYWxzZSwiZHJpZnRhYmxlIjpmYWxzZSwiY29sb3IiOjcsImRpciI6IlJJR0hUIiwicG9ydGFsSWQiOjF9LHsieCI6MiwieSI6MCwidHlwZSI6ImZpbHRlciIsImFuZ2xlIjowLCJyb3RhdGFibGUiOmZhbHNlLCJkcmlmdGFibGUiOmZhbHNlLCJjb2xvciI6MywiZGlyIjpudWxsLCJwb3J0YWxJZCI6MX0seyJ4Ijo0LCJ5IjowLCJ0eXBlIjoibWlycm9yIiwiYW5nbGUiOjAsInJvdGF0YWJsZSI6dHJ1ZSwiZHJpZnRhYmxlIjpmYWxzZSwiY29sb3IiOjAsImRpciI6bnVsbCwicG9ydGFsSWQiOjF9LHsieCI6NCwieSI6MiwidHlwZSI6InBvcnRhbCIsImFuZ2xlIjowLCJyb3RhdGFibGUiOmZhbHNlLCJkcmlmdGFibGUiOmZhbHNlLCJjb2xvciI6MCwiZGlyIjpudWxsLCJwb3J0YWxJZCI6MX0seyJ4IjoxLCJ5Ijo0LCJ0eXBlIjoicG9ydGFsIiwiYW5nbGUiOjAsInJvdGF0YWJsZSI6ZmFsc2UsImRyaWZ0YWJsZSI6ZmFsc2UsImNvbG9yIjowLCJkaXIiOm51bGwsInBvcnRhbElkIjoxfSx7IngiOjEsInkiOjUsInR5cGUiOiJtaXJyb3IiLCJhbmdsZSI6MCwicm90YXRhYmxlIjp0cnVlLCJkcmlmdGFibGUiOmZhbHNlLCJjb2xvciI6MCwiZGlyIjpudWxsLCJwb3J0YWxJZCI6MX0seyJ4Ijo1LCJ5Ijo1LCJ0eXBlIjoicmVjZWl2ZXIiLCJhbmdsZSI6MCwicm90YXRhYmxlIjpmYWxzZSwiZHJpZnRhYmxlIjpmYWxzZSwiY29sb3IiOjMsImRpciI6bnVsbCwicG9ydGFsSWQiOjF9XX0=
```

---

## 🏆 June Solstice Game Jam Submission

This game was built using the **Antigravity IDE** powered by Google AI. Read more about the design decisions, theme connections, and Alan Turing inspirations in [https://dev.to/kanyingidickson/solstice-crypt-decrypt-the-light-3id6](https://dev.to/kanyingidickson/solstice-crypt-decrypt-the-light-3id6).

---

## 📋 Controls

| Input | Action |
| :--- | :--- |
| **Click / Tap** highlighted tile | Rotate 90° clockwise |
| **Arrow Keys** | Navigate grid cursor |
| **Space / Enter** | Rotate selected tile |
| **MUTE SFX** button | Toggle sound effects |
| **MUTE MUSIC** button | Toggle ambient music |
| **RESET SYSTEM** button | Restart current level |

---

*Built with ❤️ for the June Solstice Game Jam 2026*
