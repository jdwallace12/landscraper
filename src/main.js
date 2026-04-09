import { SceneManager } from './engine/SceneManager.js';
import { Terrain } from './engine/Terrain.js';
import { Water } from './engine/Water.js';
import { Trees } from './engine/Trees.js';
import { Skiers } from './engine/Skiers.js';
import { BrushEngine } from './tools/BrushEngine.js';
import { TOOLS } from './tools/tools.js';
import { History } from './history/History.js';
import { UI } from './ui/UI.js';

// ---- State ----
let seaLevel = -1;
let currentToolKey = 'raise';
let treeDensity = 5;

// ---- Init ----
const canvas = document.getElementById('canvas');
const scene = new SceneManager(canvas);
const terrain = new Terrain(200, 256);
const water = new Water(200, seaLevel);
const trees = new Trees(terrain);
const skiers = new Skiers(terrain);
const history = new History(50);

scene.add(terrain.mesh);
scene.add(water.mesh);
scene.add(trees.group);
scene.add(skiers.group);

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
  onTreeDensity(v) { treeDensity = v; },
  onSeaLevel(v) {
    seaLevel = v;
    water.setSeaLevel(v);
    terrain.updateMesh(seaLevel);
  },
  onUndo() { doUndo(); },
  onRedo() { doRedo(); },
  onReset() { doReset(); },
});

// ---- Undo / Redo wiring ----
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !e.altKey && !e.metaKey) {
    // Save snapshot before painting starts
    history.push(terrain.snapshot());
    ui.setUndoRedoState(history.canUndo(), history.canRedo());
  }
});

function doUndo() {
  const snap = history.undo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
    trees.updatePositions();
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

function doRedo() {
  const snap = history.redo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
    trees.updatePositions();
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

function doReset() {
  history.push(terrain.snapshot());
  terrain.reset(seaLevel);
  trees.clear();
  skiers.clear();
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

// ---- Tree & Skier placement on click ----
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.altKey || e.metaKey) return;
  if (!brush.intersectionPoint) return;

  const tool = TOOLS[currentToolKey];

  if (tool.isTree) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.placeCluster(
      brush.intersectionPoint.x,
      brush.intersectionPoint.z,
      worldRadius,
      treeDensity
    );
  }

  if (tool.isTreeClear) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.removeNear(
      brush.intersectionPoint.x,
      brush.intersectionPoint.z,
      worldRadius
    );
  }

  if (tool.isSkier) {
    skiers.spawn(brush.intersectionPoint.x, brush.intersectionPoint.z);
  }
});

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

  const modified = brush.update(seaLevel);
  if (modified) {
    trees.updatePositions();
  }

  skiers.update(dt, seaLevel);

  water.update(dt);
  scene.render();
}
animate();
