import { SceneManager } from './engine/SceneManager.js';
import { Terrain } from './engine/Terrain.js';
import { Water } from './engine/Water.js';
import { Trees } from './engine/Trees.js';
import { Skiers } from './engine/Skiers.js';
import { Chairlifts } from './engine/Chairlifts.js';
import { BrushEngine } from './tools/BrushEngine.js';
import { TOOLS } from './tools/tools.js';
import { History } from './history/History.js';
import { Snow } from './engine/Snow.js';
import { UI } from './ui/UI.js';

// ---- State ----
let seaLevel = -1;
let currentBaseElevation = 0;
let currentToolKey = 'raise';
let treeDensity = 5;
let chairliftStartPoint = null;
let isSnowing = false;

// ---- Init ----
const canvas = document.getElementById('canvas');
const scene = new SceneManager(canvas);
const terrain = new Terrain(400, 256);
const water = new Water(400, seaLevel);
const trees = new Trees(terrain);
const skiers = new Skiers(terrain);
const chairlifts = new Chairlifts(terrain);
const snow = new Snow(400);
const history = new History(50);

scene.add(terrain.mesh);
scene.add(water.mesh);
scene.add(trees.group);
scene.add(skiers.group);
scene.add(chairlifts.group);
scene.add(snow.group);

const brush = new BrushEngine(terrain, scene.camera, canvas);
brush.setTool(TOOLS[currentToolKey]);
scene.add(brush.cursorMesh);

const ui = new UI({
  onToolChange(key) {
    currentToolKey = key;
    chairliftStartPoint = null; // Reset partial chairlifts on tool switch
    brush.setTool(TOOLS[key]);
    brush.updateCursorColor(TOOLS[key].color);
  },
  onBrushRadius(v) { brush.radius = v; },
  onBrushStrength(v) { brush.strength = v; },
  onTreeDensity(v) { treeDensity = v; },
  onBaseElevation(v) {
    if (v !== currentBaseElevation) {
      if (!history.isBatching) {
        history.push(terrain.snapshot()); // Save history before first drag shift
      }
      const delta = v - currentBaseElevation;
      currentBaseElevation = v;
      terrain.shiftGlobalHeight(delta);
      terrain.updateMesh(seaLevel);
      trees.updatePositions();
    }
  },
  onSeaLevel(v) {
    seaLevel = v;
    water.setSeaLevel(v);
    terrain.updateMesh(seaLevel);
  },
  onToggleWireframe(checked) {
    terrain.material.wireframe = checked;
  },
  onToggleSnow(checked) {
    isSnowing = checked;
    snow.toggle(checked);
  },
  onUndo() { doUndo(); },
  onRedo() { doRedo(); },
  onReset() { doReset(); },
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
  chairlifts.clear();
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

// ---- Interaction wiring (Undo, Placements, Orbit controls) ----
function handleInteractStart(e) {
  if (e.type === 'mousedown' && (e.button !== 0 || e.altKey || e.metaKey)) return;
  if (e.type === 'touchstart' && e.touches.length !== 1) return;

  if (!brush.intersectionPoint) return;

  // Save snapshot before painting starts
  history.push(terrain.snapshot());
  ui.setUndoRedoState(history.canUndo(), history.canRedo());

  const tool = TOOLS[currentToolKey];

  if (tool.isTree) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.placeCluster(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius, treeDensity);
  }

  if (tool.isTreeClear) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.removeNear(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
  }

  if (tool.isSkier) {
    skiers.spawn(brush.intersectionPoint.x, brush.intersectionPoint.z);
  }

  if (tool.isChairlift) {
    if (!chairliftStartPoint) {
      chairliftStartPoint = brush.intersectionPoint.clone();
      brush.updateCursorColor('#e63946');
    } else {
      const endPoint = brush.intersectionPoint.clone();
      chairlifts.buildLine(chairliftStartPoint, endPoint);
      chairliftStartPoint = null;
      brush.updateCursorColor(tool.color);
    }
  } else if (chairliftStartPoint) {
    chairliftStartPoint = null;
    brush.updateCursorColor(tool.color);
  }

  // Disable orbit while sculpting
  scene.controls.enabled = false;
}

function handleInteractEnd() {
  scene.controls.enabled = true;
}

canvas.addEventListener('mousedown', handleInteractStart);
canvas.addEventListener('touchstart', handleInteractStart, { passive: false });

canvas.addEventListener('mouseup', handleInteractEnd);
canvas.addEventListener('mouseleave', handleInteractEnd);
canvas.addEventListener('touchend', handleInteractEnd);
canvas.addEventListener('touchcancel', handleInteractEnd);

// ---- Render loop ----
function animate() {
  requestAnimationFrame(animate);
  const dt = scene.getDelta();

  const modified = brush.update(seaLevel);
  if (modified) {
    trees.updatePositions();
  }

  skiers.update(dt, seaLevel, chairlifts, isSnowing);
  chairlifts.update(dt);
  snow.update(dt);

  water.update(dt);
  scene.render();
}
animate();
