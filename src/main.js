function sendLog(type, msg) {
  fetch('http://localhost:9999', { method: 'POST', body: JSON.stringify({type, msg}) }).catch(e=>e);
}
const oldLog = console.log;
const oldError = console.error;
console.log = (...args) => { oldLog(...args); sendLog('log', args.join(' ')); };
console.error = (...args) => { oldError(...args); sendLog('error', args.join(' ')); };
window.onerror = (msg, url, line) => { sendLog('uncaught', `${msg} at ${line}`); };

import * as THREE from 'three/webgpu';
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
import { Boulders } from './engine/Boulders.js';
import { UI } from './ui/UI.js';
import { Clouds } from './engine/Clouds.js';
import { PlayerSkier } from './engine/PlayerSkier.js';

// ---- Boot ----
(async () => {

// ---- State ----
let seaLevel = -1;
let currentBaseElevation = 0;
let currentToolKey = 'raise';
let treeDensity = 5;
let chairliftStartPoint = null;
let isSnowing = false;
let isClouds = false;
let isSkierMode = false;
let isTourMode = false;
let tourTime = 0;
let isSkierPlacementMode = false; // waiting for user to click spawn point
let currentFileHandle = null;

// ---- Init ----
const canvas = document.getElementById('canvas');
const scene = new SceneManager(canvas);
await scene.init();
const terrain = new Terrain(400, 256);
const water = new Water(400, seaLevel);
const trees = new Trees(terrain);
const boulders = new Boulders(terrain);
const skiers = new Skiers(terrain);
const chairlifts = new Chairlifts(terrain);
const snow = new Snow(400);
const history = new History(50);
const clouds = new Clouds(terrain);
const playerSkier = new PlayerSkier(terrain);

scene.add(terrain.mesh);
scene.add(water.mesh);
scene.add(trees.group);
scene.add(boulders.group);
scene.add(skiers.group);
scene.add(chairlifts.group);
scene.add(snow.group);
scene.add(clouds.group);
scene.add(playerSkier.group);
clouds.updatePositions(seaLevel);

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
      trees.updatePositions(seaLevel);
      boulders.updatePositions(seaLevel);
      clouds.updatePositions(seaLevel);
    }
  },
  onSeaLevel(v) {
    seaLevel = v;
    water.setSeaLevel(v);
    terrain.updateMesh(seaLevel);
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
    clouds.updatePositions(seaLevel);
  },
  onToggleWireframe(checked) {
    terrain.material.wireframe = checked;
  },
  onToggleSnow(checked) {
    isSnowing = checked;
    snow.toggle(checked);
  },
  onToggleClouds(checked) {
    isClouds = checked;
    clouds.toggle(checked);
  },
  onToggleTour(checked) {
    isTourMode = checked;
    scene._tourMode = checked;
    if (isTourMode) {
      tourTime = 0;
      scene.controls.enabled = false;
    } else {
      scene.controls.enabled = true;
      // Sync orbit controls back to where the tour dropped us off
      scene.controls.target.copy(scene.controls.target); // Force re-eval
      scene.controls.update();
    }
  },
  onToggleSkierMode() { toggleSkierMode(); },
  onUndo() { doUndo(); },
  onRedo() { doRedo(); },
  onReset() { doReset(); },
  onSave(force) { doSaveMap(force); },
  onLoad() { triggerLoadMap(); },
});

function doUndo() {
  const snap = history.undo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
    clouds.updatePositions(seaLevel);
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

function doRedo() {
  const snap = history.redo(terrain.snapshot());
  if (snap) {
    terrain.restore(snap);
    terrain.updateMesh(seaLevel);
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
    clouds.updatePositions(seaLevel);
  }
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

function doReset() {
  history.push(terrain.snapshot());
  terrain.reset(seaLevel);
  trees.clear();
  boulders.clear();
  skiers.clear();
  chairlifts.clear();
  clouds.updatePositions(seaLevel);
  currentFileHandle = null;
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

async function doSaveMap(forcePicker = false) {
  const data = {
    heightmap: Array.from(terrain.heightmap),
    snowmap: Array.from(terrain.snowmap),
    seaLevel: seaLevel,
    baseElevation: currentBaseElevation,
    trees: trees.trees.map(t => ({ x: t.worldX, z: t.worldZ, scale: t.scale, variantIdx: t.variantIdx })),
    boulders: boulders.boulders.map(b => ({
      worldX: b.worldX, worldZ: b.worldZ, scale: b.scale, 
      scaleX: b.scaleX, scaleY: b.scaleY, scaleZ: b.scaleZ, 
      rotationX: b.rotationX, rotationY: b.rotationY, rotationZ: b.rotationZ, 
      variantIdx: b.variantIdx 
    })),
    chairlifts: chairlifts.lines.map(l => ({ 
      p1: { x: l.p1.x, y: l.p1.y, z: l.p1.z }, 
      p2: { x: l.p2.x, y: l.p2.y, z: l.p2.z } 
    }))
  };

  const jsonStr = JSON.stringify(data, null, 2);

  // Try File System Access API
  if ('showSaveFilePicker' in window) {
    try {
      if (!currentFileHandle || forcePicker) {
        currentFileHandle = await window.showSaveFilePicker({
          suggestedName: 'landscraper_map.json',
          types: [{
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          }],
        });
      }

      const writable = await currentFileHandle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      console.log("Map saved successfully to", currentFileHandle.name);
      console.log("Exported Chairlifts: ", data.chairlifts);
      ui.showSaveSuccess();
      return; 
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error("FileSystem API failed or aborted, falling back:", err);
    }
  }

  // Fallback to traditional download
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'landscraper_map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log("Exported Chairlifts: ", data.chairlifts);
  ui.showSaveSuccess();
}

async function triggerLoadMap() {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] },
        }],
      });
      currentFileHandle = handle;
      const file = await handle.getFile();
      const text = await file.text();
      loadMapData(JSON.parse(text));
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error("FileSystem API failed, falling back:", err);
    }
  }

  // Fallback
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = re => {
      try {
        const data = JSON.parse(re.target.result);
        loadMapData(data);
      } catch (err) {
        console.error("Failed to load map:", err);
        alert("Invalid map file!");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function loadMapData(data) {
  if (!data || !data.heightmap) return;

  history.push(terrain.snapshot()); // Save old state for undo

  // Restore Settings
  seaLevel = data.seaLevel ?? -1;
  currentBaseElevation = data.baseElevation ?? 0;
  
  ui.setSeaLevelSlider(seaLevel);
  ui.setBaseElevationSlider(currentBaseElevation);
  
  water.setSeaLevel(seaLevel);
  
  // Restore Terrain through Worker to trigger geometry calculations
  terrain.restore({
    heightmap: data.heightmap,
    snowmap: data.snowmap
  });
  terrain.updateMesh(seaLevel);

  // Clear existing items
  trees.clear();
  boulders.clear();
  chairlifts.clear();
  skiers.clear();
  clouds.updatePositions(seaLevel);
  
  // Restore Trees
  if (data.trees) {
    trees.loadTrees(data.trees, seaLevel);
  }

  // Restore Boulders
  if (data.boulders) {
    boulders.loadBoulders(data.boulders, seaLevel);
  }

  // Restore Chairlifts
  if (data.chairlifts) {
    data.chairlifts.forEach(lift => {
      chairlifts.buildLine(
        new THREE.Vector3(lift.p1.x, lift.p1.y, lift.p1.z),
        new THREE.Vector3(lift.p2.x, lift.p2.y, lift.p2.z)
      );
    });
  }

  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

// ---- Skier Mode ----
function toggleSkierMode() {
  if (isSkierMode) {
    exitSkierMode();
  } else if (isSkierPlacementMode) {
    // Cancel placement mode
    isSkierPlacementMode = false;
    ui.showSkierPlacement(false);
  } else {
    // Enter placement mode — next click on terrain will spawn
    isSkierPlacementMode = true;
    ui.showSkierPlacement(true);
  }
}

function enterSkierModeAt(wx, wz) {
  isSkierPlacementMode = false;
  ui.showSkierPlacement(false);
  playerSkier.spawn(wx, wz);
  scene.enterSkierMode();
  isSkierMode = true;
  brush.enabled = false;
  brush.cursorMesh.visible = false;
  ui.showSkierHUD(true);
}

function exitSkierMode() {
  if (!isSkierMode) return;
  playerSkier.despawn();
  scene.exitSkierMode();
  isSkierMode = false;
  brush.enabled = true;
  brush.cursorMesh.visible = true;
  ui.showSkierHUD(false);
}

// Listen for Escape to exit ski mode
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSkierMode) {
    exitSkierMode();
  }
});

// ---- Interaction wiring (Undo, Placements, Orbit controls) ----
function handleInteractStart(e) {
  if (isSkierMode) return; // Suppress editor interactions during ski mode, but allow during Tour Mode!

  // Skier placement mode: click to spawn
  if (isSkierPlacementMode) {
    if (brush.intersectionPoint) {
      enterSkierModeAt(brush.intersectionPoint.x, brush.intersectionPoint.z);
    }
    return;
  }

  if (e.type === 'mousedown' && (e.button !== 0 || e.altKey || e.metaKey)) return;
  if (e.type === 'touchstart' && e.touches.length !== 1) return;

  if (!brush.intersectionPoint) return;

  // Save snapshot before painting starts
  history.push(terrain.snapshot());
  ui.setUndoRedoState(history.canUndo(), history.canRedo());

  const tool = TOOLS[currentToolKey];

  if (tool.isTree) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.placeCluster(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius, treeDensity, seaLevel);
  }

  if (tool.isBoulder) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    boulders.placeCluster(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius, treeDensity, seaLevel);
  }

  if (tool.isDemolish) {
    const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
    trees.removeNear(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
    boulders.removeNear(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
    chairlifts.removeNear(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
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
  clouds.updatePositions(seaLevel);
}

canvas.addEventListener('mousedown', handleInteractStart);
canvas.addEventListener('touchstart', handleInteractStart, { passive: false });

canvas.addEventListener('mouseup', handleInteractEnd);
canvas.addEventListener('mouseleave', handleInteractEnd);
canvas.addEventListener('touchend', handleInteractEnd);
canvas.addEventListener('touchcancel', handleInteractEnd);

// ---- Render loop ----
const PHYSICS_DT = 1 / 120; // Fixed 120Hz physics timestep
let physicsAccumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = scene.getDelta();

  // --- Physics & Simulation Loop ---
  physicsAccumulator += Math.min(dt, 0.05); // Cap 
  
  while (physicsAccumulator >= PHYSICS_DT) {
    if (isSkierMode) {
      const alive = playerSkier.update(PHYSICS_DT, chairlifts);
      if (!alive) {
        physicsAccumulator = 0;
        exitSkierMode();
        break;
      }
    }
    
    // Simulations must run inside the physics step to stay perfectly synchronized
    skiers.update(PHYSICS_DT, seaLevel, chairlifts, isSnowing, clouds);
    chairlifts.update(PHYSICS_DT);
    
    physicsAccumulator -= PHYSICS_DT;
  }

  // --- Visuals & Camera ---
  if (isSkierMode) {
    const alpha = physicsAccumulator / PHYSICS_DT;
    playerSkier.interpolateVisuals(alpha, dt);
    const cam = playerSkier.getCameraTarget(alpha);
    scene.updateSkierCamera(cam.position, cam.lookAt, dt);
    ui.updateSkierSpeed(playerSkier.speed);
  } else if (isTourMode) {
    tourTime += dt;
    const cx = 0; 
    const cz = 0;
    const radius = 160 + Math.sin(tourTime * 0.08) * 60; 
    const angle = tourTime * 0.12; 
    const camX = cx + Math.cos(angle) * radius;
    const camZ = cz + Math.sin(angle) * radius;
    let h = terrain.getInterpolatedHeight(camX, camZ);
    if (isNaN(h)) h = seaLevel;
    const camY = Math.max(h + 35, 90 + Math.sin(tourTime * 0.1) * 40);
    const lookX = cx + Math.cos(angle + 0.4) * 30;
    const lookZ = cz + Math.sin(angle + 0.4) * 30;
    const smoothGlide = 1 - Math.pow(0.1, dt); 
    scene.camera.position.lerp(new THREE.Vector3(camX, camY, camZ), smoothGlide);
    scene.controls.target.lerp(new THREE.Vector3(lookX, seaLevel + 5, lookZ), smoothGlide);
    scene.camera.lookAt(scene.controls.target); 
  }

  const modified = brush.update(seaLevel);
  if (modified) {
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
  }

  // Visual-only updates (don't need perfect physics sync)
  snow.update(dt);
  clouds.update(dt);
  water.update(dt);

  scene.render();
}
animate();

})();
