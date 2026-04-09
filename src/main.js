import { SceneManager } from './engine/SceneManager.js';
import { Terrain } from './engine/Terrain.js';
import { Water } from './engine/Water.js';
import { BrushEngine } from './tools/BrushEngine.js';
import { TOOLS } from './tools/tools.js';
import { History } from './history/History.js';
import { UI } from './ui/UI.js';

// ---- State ----
let seaLevel = -1;
let currentToolKey = 'raise';
let snapshotPending = false;

// ---- Init ----
const canvas = document.getElementById('canvas');
const scene = new SceneManager(canvas);
const terrain = new Terrain(200, 256);
const water = new Water(200, seaLevel);
const history = new History(50);

scene.add(terrain.mesh);
scene.add(water.mesh);

const brush = new BrushEngine(terrain, scene.camera, canvas);
brush.setTool(TOOLS[currentToolKey]);
scene.add(brush.cursorMesh);

const ui = new UI({
  onToolChange(key) {
    currentToolKey = key;
    brush.setTool(TOOLS[key]);
    brush.updateCursorColor(TOOLS[key].color);
  },
  onBrushRadius(v) { brush.radius = v; },
  onBrushStrength(v) { brush.strength = v; },
  onSeaLevel(v) {
    seaLevel = v;
    water.setSeaLevel(v);
    terrain.updateMesh(seaLevel);
  },
  onUndo() { doUndo(); },
  onRedo() { doRedo(); },
});

// ---- Undo / Redo wiring ----
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !e.altKey && !e.metaKey) {
    // Save snapshot before painting starts
    history.push(terrain.snapshot());
    snapshotPending = false;
    ui.setUndoRedoState(history.canUndo(), history.canRedo());
  }
});

function doUndo() {
  const snap = history.undo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

function doRedo() {
  const snap = history.redo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

// ---- Disable orbit while sculpting ----
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !e.altKey && !e.metaKey && brush.intersectionPoint) {
    scene.controls.enabled = false;
  }
});
canvas.addEventListener('mouseup', () => {
  scene.controls.enabled = true;
});
canvas.addEventListener('mouseleave', () => {
  scene.controls.enabled = true;
});

// ---- Render loop ----
function animate() {
  requestAnimationFrame(animate);
  const dt = scene.getDelta();
  brush.update(seaLevel);
  water.update(dt);
  scene.render();
}
animate();
