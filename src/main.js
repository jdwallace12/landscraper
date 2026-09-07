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
import { Rivers } from './engine/Rivers.js';
import { BrushEngine } from './tools/BrushEngine.js';
import { TOOLS } from './tools/tools.js';
import { History } from './history/History.js';
import { Snow } from './engine/Snow.js';
import { Boulders } from './engine/Boulders.js';
import { UI } from './ui/UI.js';
import { Clouds } from './engine/Clouds.js';
import { PlayerSkier } from './engine/PlayerSkier.js';
import { SnowGlints } from './engine/SnowGlints.js';

// ---- Boot ----
(async () => {

// ---- State ----
let seaLevel = 1;
let currentBaseElevation = 0;
let currentToolKey = 'raise';
let treeDensity = 5;
let chairliftStartPoint = null;
let riverSourcePoint = null;
let isSnowing = false;
let isClouds = false;
let isSkierMode = false;
let isTourMode = false;
let tourTime = 0;
let isSkierPlacementMode = false; // waiting for user to click spawn point
let currentFileHandle = null;
let lastPlacementTime = 0;

// ---- Init ----
const canvas = document.getElementById('canvas');
const scene = new SceneManager(canvas);
await scene.init();
const terrain = new Terrain(400, 256);
const water = new Water(400, seaLevel, terrain);
const trees = new Trees(terrain);
const boulders = new Boulders(terrain);
const skiers = new Skiers(terrain);
const chairlifts = new Chairlifts(terrain);
const rivers = new Rivers(terrain);
const snow = new Snow(400);
const history = new History(50);
const clouds = new Clouds(terrain);
const playerSkier = new PlayerSkier(terrain);
playerSkier.seaLevel = seaLevel;
playerSkier.water = water;
const snowGlints = new SnowGlints(terrain, 2500);

scene.add(terrain.mesh);
scene.add(water.mesh);
scene.add(trees.group);
scene.add(boulders.group);
scene.add(skiers.group);
scene.add(chairlifts.group);
scene.add(rivers.group);
scene.add(snow.group);
scene.add(clouds.group);
scene.add(playerSkier.group);
scene.add(snowGlints.group);
clouds.updatePositions(seaLevel);

const brush = new BrushEngine(terrain, scene.camera, canvas);
brush.setTool(TOOLS[currentToolKey]);
scene.add(brush.cursorMesh);

const aimCursorGroup = new THREE.Group();
const aimCrossMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false });
const vBar = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.2), aimCrossMat);
const hBar = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.2), aimCrossMat);
aimCursorGroup.add(vBar, hBar);
aimCursorGroup.visible = false;
aimCursorGroup.renderOrder = 999; // Always render on top
const aimCursor = aimCursorGroup;
scene.add(aimCursor);

const ui = new UI({
  onToolChange(key) {
    currentToolKey = key;
    chairliftStartPoint = null; // Reset partial chairlifts on tool switch
    riverSourcePoint = null;    // Reset partial river on tool switch
    ui.showRiverHint(null);
    ui.showChairliftHint(null);
    const tool = TOOLS[key];
    brush.setTool(tool);
    brush.updateCursorColor(tool.color);

    if (tool.isPan) {
      scene.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      scene.controls.touches.ONE = THREE.TOUCH.PAN;
    } else {
      scene.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      scene.controls.touches.ONE = THREE.TOUCH.ROTATE;
    }
  },
  onBrushRadius(v) { brush.radius = v; },
  onBrushStrength(v) { brush.strength = v; },
  onNoiseLevel(v) { brush.noiseAmount = v; },
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
    playerSkier.seaLevel = v;
    terrain.updateMesh(seaLevel);
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
    clouds.updatePositions(seaLevel);
  },
  onSnowPack(v) {
    terrain.snowPack = v;
    terrain.updateSnowPack(v);
  },
  onCloudAmount(v) {
    clouds.setAmount(v);
  },
  onTimeOfDay(v) {
    scene.setTimeOfDay(v);
  },
  onLightingPreset(presetId) {
    scene.setLightingPreset(presetId);
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
  onResetCamera() { scene.resetCamera(); },
  onMobileControl(dir, active) {
    // Map D-pad directions to skier control keys
    const skierKeyMap = { 'up': 'forward', 'down': 'brake', 'left': 'left', 'right': 'right', 'jump': 'jump', 'parachute': 'paraglide' };
    if (playerSkier._keys && skierKeyMap[dir]) {
      playerSkier._keys[skierKeyMap[dir]] = active;
      if (dir === 'parachute' && active && playerSkier.toggleParachute) {
        playerSkier.toggleParachute();
      }
    }
    if (mobileMovement[dir] !== undefined) {
      mobileMovement[dir] = active;
    }
  },
  onToggleTrails(checked) {
    skiers.setTrailsVisible(checked);
    playerSkier.setTrailsVisible(checked);
  },
  onUndo() { doUndo(); },
  onRedo() { doRedo(); },
  onReset() { doReset(); },
  onSave(force) { doSaveMap(force); },
  onLoad() { triggerLoadMap(); },
  onSmoothStart() {
    history.push(terrain.snapshot());
    ui.setUndoRedoState(history.canUndo(), history.canRedo());
    terrain.smoothStart();
  },
  onSmoothGlobal(val) {
    terrain.smoothGlobal(val);
    water.updateDepthMap();
    trees.updatePositions(seaLevel);
    boulders.updatePositions(seaLevel);
    clouds.updatePositions(seaLevel);
  },
});

function generateInitialFoliage() {
  const mapSize = terrain.size;

  // Let's place clusters of trees
  const numTreeClusters = 45;
  for (let i = 0; i < numTreeClusters; i++) {
    const tx = (Math.random() - 0.5) * mapSize;
    const tz = (Math.random() - 0.5) * mapSize;
    const h = terrain.getInterpolatedHeight(tx, tz);
    
    if (h > seaLevel + 1.0 && h < seaLevel + 35.0) {
      const radius = 12 + Math.random() * 16;
      const density = 4 + Math.random() * 4;
      trees.placeCluster(tx, tz, radius, density, seaLevel);
    }
  }


}

let firstInit = true;
terrain.addOnInitListener(() => {
  if (firstInit) {
    firstInit = false;
    generateInitialFoliage();
  }
});

const mobileMovement = { up: false, down: false, left: false, right: false };

function updateMobileCamera(dt) {
  if (isSkierMode || isTourMode) return;
  
  const moveSpeed = 150 * dt;
  const camDir = new THREE.Vector3();
  scene.camera.getWorldDirection(camDir);
  camDir.y = 0;
  camDir.normalize();
  
  const sideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();
  
  const moveVec = new THREE.Vector3(0, 0, 0);
  if (mobileMovement.up) moveVec.addScaledVector(camDir, moveSpeed);
  if (mobileMovement.down) moveVec.addScaledVector(camDir, -moveSpeed);
  if (mobileMovement.left) moveVec.addScaledVector(sideDir, moveSpeed);
  if (mobileMovement.right) moveVec.addScaledVector(sideDir, -moveSpeed);
  
  if (moveVec.lengthSq() > 0) {
    scene.camera.position.add(moveVec);
    scene.controls.target.add(moveVec);
    scene.controls.update();
  }
}

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
  
  // Reset sea level to 1 and sync UI
  seaLevel = 1;
  if (ui.seaLevelSlider) {
    ui.seaLevelSlider.value = 1;
    ui.seaLevelSlider.nextElementSibling.innerText = '1';
  }

  // Reset snow pack to 80 and sync UI
  terrain.snowPack = 80;
  if (ui.snowPackSlider) {
    ui.setSnowPackSlider(80);
  }

  terrain.reset(seaLevel);
  trees.clear();
  boulders.clear();
  skiers.clear();
  chairlifts.clear();
  rivers.clear();
  clouds.updatePositions(seaLevel);
  currentFileHandle = null;
  ui.setSmoothnessSlider(0);
  ui.setUndoRedoState(history.canUndo(), history.canRedo());
}

async function doSaveMap(forcePicker = false) {
  const data = {
    heightmap: Array.from(terrain.heightmap),
    snowmap: Array.from(terrain.snowmap),
    seaLevel: seaLevel,
    baseElevation: currentBaseElevation,
    snowPack: terrain.snowPack,
    trees: trees.trees.map(t => ({ x: t.worldX, z: t.worldZ, scale: t.scale, variantIdx: t.variantIdx })),
    boulders: boulders.boulders.map(b => ({
      worldX: b.worldX, worldZ: b.worldZ, scale: b.scale, 
      scaleX: b.scaleX, scaleY: b.scaleY, scaleZ: b.scaleZ, 
      rotationX: b.rotationX, rotationY: b.rotationY, rotationZ: b.rotationZ, 
      variantIdx: b.variantIdx 
    })),
    chairlifts: chairlifts.lines.map(l => ({ 
      p1: { x: l.p1.x, y: l.p1.y, z: l.p1.z }, 
      p2: { x: l.p2.x, y: l.p2.y, z: l.p2.z },
      type: l.type || 'chairlift'
    })),
    rivers: rivers.rivers.map(r => ({
      p1: { x: r.p1.x, y: r.p1.y, z: r.p1.z },
      p2: { x: r.p2.x, y: r.p2.y, z: r.p2.z },
      channelWidth: r.channelWidth,
      channelDepth: r.channelDepth
    }))
  };

  const jsonStr = JSON.stringify(data, null, 2);

  // Try File System Access API
  if ('showSaveFilePicker' in window) {
    try {
      if (!currentFileHandle || forcePicker) {
        currentFileHandle = await window.showSaveFilePicker({
          suggestedName: 'gnarscaper_map.json',
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
  a.download = 'gnarscaper_map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function triggerLoadMap() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        loadMapData(data);
      } catch (err) {
        console.error('Failed to parse map file:', err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function loadMapData(data) {
  history.push(terrain.snapshot());

  seaLevel = data.seaLevel ?? 1;
  currentBaseElevation = data.baseElevation ?? 0;
  terrain.snowPack = data.snowPack ?? 50;
  
  ui.setSeaLevelSlider(seaLevel);
  ui.setBaseElevationSlider(currentBaseElevation);
  ui.setSnowPackSlider(terrain.snowPack);
  
  water.setSeaLevel(seaLevel);
  playerSkier.seaLevel = seaLevel;
  terrain.updateSnowPack(terrain.snowPack);
  
  // Restore Terrain through Worker to trigger geometry calculations
  terrain.restore({
    heightmap: data.heightmap,
    snowmap: data.snowmap,
    grassmap: data.grassmap
  });
  terrain.updateMesh(seaLevel);


  // Clear existing items
  trees.clear();
  boulders.clear();
  chairlifts.clear();
  rivers.clear();
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

  // Restore Chairlifts & Aerial Trams
  if (data.chairlifts) {
    data.chairlifts.forEach(lift => {
      chairlifts.buildLine(
        new THREE.Vector3(lift.p1.x, lift.p1.y, lift.p1.z),
        new THREE.Vector3(lift.p2.x, lift.p2.y, lift.p2.z),
        { type: lift.type || 'chairlift' }
      );
    });
  }

  // Restore Rivers
  if (data.rivers) {
    data.rivers.forEach(rv => {
      rivers.buildRiver(
        new THREE.Vector3(rv.p1.x, rv.p1.y, rv.p1.z),
        new THREE.Vector3(rv.p2.x, rv.p2.y, rv.p2.z),
        rv.channelWidth ?? 8,
        rv.channelDepth ?? 6
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
  const skierPos = new THREE.Vector3(playerSkier.wx, playerSkier.wy, playerSkier.wz);
  playerSkier.despawn();
  scene.exitSkierMode(skierPos);
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

  ui.setSmoothnessSlider(0);

  const tool = TOOLS[currentToolKey];
  if (tool && tool.isCamera) {
    return; // Leave scene.controls.enabled = true so OrbitControls can pan/rotate
  }

  // Save snapshot before painting starts
  history.push(terrain.snapshot());
  ui.setUndoRedoState(history.canUndo(), history.canRedo());

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
    rivers.removeNear(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
  }

  if (tool.isSkier) {
    skiers.spawn(brush.intersectionPoint.x, brush.intersectionPoint.z);
  }

  if (tool.isChairlift || tool.isTram) {
    if (!chairliftStartPoint) {
      chairliftStartPoint = brush.intersectionPoint.clone();
      brush.updateCursorColor('#e63946');
      const liftName = tool.name || (tool.isTram ? 'Aerial Tram' : 'Chairlift');
      const icon = tool.icon || (tool.isTram ? '🚠' : '🚡');
      ui.showChairliftHint(`${icon} ${liftName} base set! Now click the summit station location.`);
    } else {
      const endPoint = brush.intersectionPoint.clone();
      const liftType = tool.liftType || (tool.isTram ? 'tram' : 'chairlift');
      chairlifts.buildLine(chairliftStartPoint, endPoint, { type: liftType });
      chairliftStartPoint = null;
      brush.updateCursorColor(tool.color);
      ui.showChairliftHint(null);
    }
  } else if (chairliftStartPoint) {
    chairliftStartPoint = null;
    brush.updateCursorColor(tool.color);
    ui.showChairliftHint(null);
  }

  if (tool.isRiver) {
    if (!riverSourcePoint) {
      // First click — record source (top/upstream)
      riverSourcePoint = brush.intersectionPoint.clone();
      brush.updateCursorColor('#06b6d4'); // cyan = waiting for mouth
      ui.showRiverHint('🏞️ River source set! Now click the downstream end (mouth).');
    } else {
      // Second click — carve the river
      history.push(terrain.snapshot());
      ui.setUndoRedoState(history.canUndo(), history.canRedo());
      const mouthPoint = brush.intersectionPoint.clone();
      rivers.buildRiver(riverSourcePoint, mouthPoint, brush.radius * 0.7, brush.strength * 18);
      terrain.updateMesh(seaLevel);
      trees.updatePositions(seaLevel);
      boulders.updatePositions(seaLevel);
      riverSourcePoint = null;
      brush.updateCursorColor(tool.color);
      ui.showRiverHint(null);
    }
  } else if (riverSourcePoint) {
    riverSourcePoint = null;
    brush.updateCursorColor(TOOLS[currentToolKey].color);
    ui.showRiverHint(null);
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
const PHYSICS_DT = 1 / 60; // Optimized 60Hz physics timestep
let physicsAccumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = scene.getDelta();

  // --- Chairlift Interactions ---
  if (isSkierMode && playerSkier.active && playerSkier.state === 'riding') {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), scene.camera);
    const intersects = raycaster.intersectObject(terrain.mesh);
    
    if (intersects.length > 0) {
      aimCursor.visible = true;
      aimCursor.position.copy(intersects[0].point);
      
      // Face the camera perfectly so it acts like a 2D crosshair
      aimCursor.quaternion.copy(scene.camera.quaternion);
      
      // Scale dot based on distance so it stays visible when aiming far away
      const dist = scene.camera.position.distanceTo(aimCursor.position);
      aimCursor.scale.setScalar(Math.max(1.0, dist / 25.0));

      if (playerSkier._keys.jump) {
        playerSkier._keys.jump = false; // consume
        skiers.spawn(intersects[0].point.x, intersects[0].point.z);
      }
    } else {
      aimCursor.visible = false;
    }
  } else {
    aimCursor.visible = false;
  }

  // Update HUD text if state changed
  if (isSkierMode && playerSkier.active) {
    if (playerSkier.state !== window.lastSkierState) {
      ui.setSkierControlsText(playerSkier.state);
      window.lastSkierState = playerSkier.state;
    }
  }

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
    skiers.update(PHYSICS_DT, water, chairlifts, isSnowing, clouds);
    chairlifts.update(PHYSICS_DT);
    rivers.update(PHYSICS_DT);
    
    physicsAccumulator -= PHYSICS_DT;
  }

  // --- Visuals & Camera ---
  if (isSkierMode) {
    const alpha = physicsAccumulator / PHYSICS_DT;
    playerSkier.interpolateVisuals(alpha, dt);
    const cam = playerSkier.getCameraTarget(alpha, dt);
    scene.updateSkierCamera(cam.position, cam.lookAt, dt);
    ui.updateSkierSpeed(playerSkier.speed, playerSkier.isClimbing, playerSkier.y);
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

  if (brush.enabled && brush.painting && !isSkierMode) {
    const tool = TOOLS[currentToolKey];
    if (tool && (tool.isTree || tool.isBoulder) && brush.intersectionPoint) {
      // Throttle tree/boulder placement to avoid overcrowding
      const now = performance.now();
      if (now - lastPlacementTime > 100) { // 10 placements per second
        const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
        if (tool.isTree) trees.placeCluster(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius, treeDensity, seaLevel);
        if (tool.isBoulder) boulders.placeCluster(brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius, treeDensity, seaLevel);
        lastPlacementTime = now;
      }
    }
  }

  const modified = brush.update(seaLevel);
  if (modified) {
    water.updateDepthMap();
    if (brush.intersectionPoint) {
      const worldRadius = (brush.radius / terrain.resolution) * terrain.size;
      trees.updatePositions(seaLevel, brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
      boulders.updatePositions(seaLevel, brush.intersectionPoint.x, brush.intersectionPoint.z, worldRadius);
    } else {
      trees.updatePositions(seaLevel);
      boulders.updatePositions(seaLevel);
    }
  }



  // Visual-only updates (don't need perfect physics sync)
  snow.update(dt);
  clouds.update(dt);
  water.update(dt);
  
  const glintCenter = (isSkierMode && playerSkier.mesh) ? playerSkier.mesh.position : scene.camera.position;
  snowGlints.update(dt, glintCenter);

  if (isSkierMode) {
    // ...
  } else {
    updateMobileCamera(dt);
  }

  scene.render();
}
animate();

})();
