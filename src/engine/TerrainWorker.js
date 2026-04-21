import * as THREE from 'three';
import { TOOLS } from '../tools/tools.js';

const DEEP_WATER = new THREE.Color(0x0a2a4a);
const SHALLOW = new THREE.Color(0x1a6e8e);
const SAND = new THREE.Color(0xc2b280);
const GRASS_LOW = new THREE.Color(0x4a7c3f);
const GRASS_HIGH = new THREE.Color(0x2d5a27);
const ROCK = new THREE.Color(0x6b6b6b);
const SNOW = new THREE.Color(0xf0f0f0);

let size = 200;
let resolution = 256;
let heightmap = null;
let snowmap = null;
let currentSeaLevel = 0;

const _tmpBase = new THREE.Color();
const _tmpResult = new THREE.Color();

function _colorForHeight(h, seaLevel, steepness = 0, snowAmount = 0) {
  const base = _tmpBase;
  const result = _tmpResult;
  
  if (h < seaLevel - 4) {
    base.copy(DEEP_WATER);
  } else if (h < seaLevel - 1) {
    base.lerpColors(DEEP_WATER, SHALLOW, (h - (seaLevel - 4)) / 3);
  } else if (h < seaLevel + 0.5) {
    base.lerpColors(SHALLOW, SAND, (h - (seaLevel - 1)) / 1.5);
  } else if (h < seaLevel + 6) {
    base.lerpColors(SAND, GRASS_LOW, (h - (seaLevel + 0.5)) / 5.5);
  } else if (h < seaLevel + 15) {
    base.lerpColors(GRASS_LOW, GRASS_HIGH, (h - (seaLevel + 6)) / 9);
  } else if (h < seaLevel + 28) {
    base.lerpColors(GRASS_HIGH, ROCK, (h - (seaLevel + 15)) / 13);
  } else if (h < seaLevel + 40) {
    base.lerpColors(ROCK, SNOW, (h - (seaLevel + 28)) / 12);
  } else {
    base.copy(SNOW);
  }

  if (h > seaLevel + 0.5 && steepness > 0.6) {
    const steepFactor = Math.min((steepness - 0.6) / 0.5, 1.0);
    result.lerpColors(base, ROCK, steepFactor);
    base.copy(result);
  }

  if (snowAmount > 0.05) {
    result.lerpColors(base, SNOW, Math.min(snowAmount, 1.0));
    return result;
  }

  return base;
}

function _generateInitialTerrain() {
  const res = resolution;
  const pX1 = Math.random() * Math.PI * 2;
  const pZ1 = Math.random() * Math.PI * 2;
  const pX2 = Math.random() * Math.PI * 2;
  const pZ2 = Math.random() * Math.PI * 2;
  const pX3 = Math.random() * Math.PI * 2;
  const pZ3 = Math.random() * Math.PI * 2;
  const cxOffset = (Math.random() - 0.5) * 0.3;
  const czOffset = (Math.random() - 0.5) * 0.3;

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / res;
      const nz = z / res;
      const cx = nx - 0.5 + cxOffset;
      const cz = nz - 0.5 + czOffset;
      const distFromCenterSq = cx*cx + cz*cz;
      const mountainShape = Math.max(0, 1.0 - Math.sqrt(distFromCenterSq) * 1.8);
      let h = mountainShape * 45.0;

      h += Math.sin(nx * 5.0 * Math.PI + pX1) * Math.cos(nz * 4.0 * Math.PI + pZ1) * 8.0;
      h += Math.sin(nx * 12.5 * Math.PI + pX2) * Math.cos(nz * 10.2 * Math.PI + pZ2) * 4.5;
      h += Math.sin(nx * 26.0 * Math.PI + pX3) * Math.cos(nz * 22.0 * Math.PI + pZ3) * 2.0;

      const edgeX = 1 - Math.pow(2 * nx - 1, 6);
      const edgeZ = 1 - Math.pow(2 * nz - 1, 6);
      h *= Math.min(edgeX, edgeZ);
      
      heightmap[z * res + x] = h;
    }
  }
}

function computeColors(seaLevel = 0) {
  const count = resolution * resolution;
  const colors = new Float32Array(count * 3);
  const spacing = size / (resolution - 1);
  const invSpacing2 = 1 / (2 * spacing);

  for (let i = 0; i < count; i++) {
    const h = heightmap[i];

    const gx = i % resolution;
    const gz = (i / resolution) | 0;

    const hL = gx > 0 ? heightmap[gz * resolution + (gx - 1)] : heightmap[gz * resolution + gx];
    const hR = gx < resolution - 1 ? heightmap[gz * resolution + (gx + 1)] : heightmap[gz * resolution + gx];
    const hU = gz > 0 ? heightmap[(gz - 1) * resolution + gx] : heightmap[gz * resolution + gx];
    const hD = gz < resolution - 1 ? heightmap[(gz + 1) * resolution + gx] : heightmap[gz * resolution + gx];

    const gradX = (hR - hL) * invSpacing2;
    const gradZ = (hD - hU) * invSpacing2;
    const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);

    const c = _colorForHeight(h, seaLevel, steepness, snowmap[i]);
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return colors;
}

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === 'init') {
    size = msg.size || 200;
    resolution = msg.resolution || 256;
    
    heightmap = new Float32Array(resolution * resolution);
    snowmap = new Float32Array(resolution * resolution);
    
    if (msg.heightmap && msg.snowmap) {
      heightmap.set(msg.heightmap);
      snowmap.set(msg.snowmap);
    } else {
      _generateInitialTerrain();
    }
    
    if (msg.seaLevel !== undefined) currentSeaLevel = msg.seaLevel;
    const colors = computeColors(currentSeaLevel);
    
    self.postMessage({
      type: 'init_done',
      heightmap: new Float32Array(heightmap), // copy to send back
      snowmap: new Float32Array(snowmap),
      colors: colors
    });
  } 
  else if (msg.type === 'sculpt') {
    const { toolName, cx, cz, radius, strength, isStart, toolState } = msg;
    const tool = TOOLS[toolName];
    
    if (tool && tool.apply) {
      // Re-hydrate any necessary state for continuous tools like Ramp or Flatten
      if (toolState) {
        Object.assign(tool, toolState);
      }
      
      const mapToApply = tool.isSnowBrush ? snowmap : heightmap;
      tool.apply(mapToApply, resolution, cx, cz, radius, strength, isStart);
      
      const colors = computeColors(currentSeaLevel);
      
      self.postMessage({
        type: 'sculpt_done',
        heightmap: new Float32Array(heightmap),
        snowmap: new Float32Array(snowmap),
        colors: colors,
        // Send state back so main thread can store it if needed
        toolState: {
           _targetHeight: tool._targetHeight,
           _startX: tool._startX,
           _startZ: tool._startZ,
           _startH: tool._startH
        }
      });
    }
  }
  else if (msg.type === 'shiftGlobal') {
    const { delta } = msg;
    for (let i = 0; i < heightmap.length; i++) {
      heightmap[i] += delta;
    }
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'shift_done',
      heightmap: new Float32Array(heightmap),
      colors: colors
    });
  }
  else if (msg.type === 'reset') {
    heightmap.fill(0);
    snowmap.fill(0);
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'reset_done',
      heightmap: new Float32Array(heightmap),
      snowmap: new Float32Array(snowmap),
      colors: colors
    });
  }
  else if (msg.type === 'updateSeaLevel') {
    currentSeaLevel = msg.seaLevel;
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'colors_update',
      colors: colors
    });
  }
};
