import * as THREE from "three";

const DEEP_WATER = new THREE.Color(0x0a2a4a);
const SHALLOW = new THREE.Color(0x1a6e8e);
const SAND = new THREE.Color(0xc2b280);
const GRASS_LOW = new THREE.Color(0x4a7c3f);
const GRASS_HIGH = new THREE.Color(0x2d5a27);
const ROCK = new THREE.Color(0x6b6b6b);
const SNOW = new THREE.Color(0xf0f0f0);

export class Terrain {
  /**
   * @param {number} size – world units for the terrain square
   * @param {number} resolution – vertices per side (e.g. 256)
   */
  constructor(size = 200, resolution = 256) {
    this.size = size;
    this.resolution = resolution;
    this.heightmap = new Float32Array(resolution * resolution);
    this.snowmap = new Float32Array(resolution * resolution);

    // Build geometry
    this.geometry = new THREE.PlaneGeometry(
      size,
      size,
      resolution - 1,
      resolution - 1,
    );
    this.geometry.rotateX(-Math.PI / 2); // lay flat

    // Pre-allocate vertex color buffer
    const count = this.geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Material with vertex colors
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.05,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Generate some initial gentle terrain
    this._generateInitialTerrain();
    this.updateMesh();
  }

  /* ---- public API ---- */

  getHeight(gx, gz) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return 0;
    return this.heightmap[gz * this.resolution + gx];
  }

  setHeight(gx, gz, value) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return;
    this.heightmap[gz * this.resolution + gx] = value;
  }

  /** Get smooth interpolated height at world position */
  getInterpolatedHeight(wx, wz) {
    const half = this.size / 2;
    const fx = ((wx + half) / this.size) * (this.resolution - 1);
    const fz = ((wz + half) / this.size) * (this.resolution - 1);
    
    if (fx < 0 || fx >= this.resolution - 1 || fz < 0 || fz >= this.resolution - 1) {
      // Out of bounds, return nearest grid height
      const { gx, gz } = this.worldToGrid(wx, wz);
      return this.getHeight(gx, gz);
    }

    const gx0 = Math.floor(fx);
    const gx1 = gx0 + 1;
    const gz0 = Math.floor(fz);
    const gz1 = gz0 + 1;
    
    const tx = fx - gx0;
    const tz = fz - gz0;
    
    const h00 = this.getHeight(gx0, gz0);
    const h10 = this.getHeight(gx1, gz0);
    const h01 = this.getHeight(gx0, gz1);
    const h11 = this.getHeight(gx1, gz1);
    
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    
    return h0 * (1 - tz) + h1 * tz;
  }

  /** Convert world (x, z) → grid indices */
  worldToGrid(wx, wz) {
    const half = this.size / 2;
    const gx = Math.round(((wx + half) / this.size) * (this.resolution - 1));
    const gz = Math.round(((wz + half) / this.size) * (this.resolution - 1));
    return { gx, gz };
  }

  /** Snapshot the heightmap and snowmap for undo */
  snapshot() {
    return {
      heightmap: new Float32Array(this.heightmap),
      snowmap: new Float32Array(this.snowmap)
    };
  }

  /** Restore from a snapshot */
  restore(snap) {
    if (snap.heightmap) this.heightmap.set(snap.heightmap);
    if (snap.snowmap) this.snowmap.set(snap.snowmap);
    this.updateMesh();
  }

  /** Reset terrain to flat (all zeros) */
  reset(seaLevel = 0) {
    this.heightmap.fill(0);
    this.snowmap.fill(0);
    this.updateMesh(seaLevel);
  }

  /** Push heightmap data into geometry and recolor */
  updateMesh(seaLevel = 0) {
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;
    const res = this.resolution;

    for (let i = 0; i < pos.count; i++) {
      const h = this.heightmap[i];
      pos.setY(i, h);

      const gx = i % res;
      const gz = Math.floor(i / res);
      
      const hL = this.getHeight(gx - 1, gz);
      const hR = this.getHeight(gx + 1, gz);
      const hU = this.getHeight(gx, gz - 1);
      const hD = this.getHeight(gx, gz + 1);

      const spacing = this.size / (res - 1);
      const gradX = (hR - hL) / (2 * spacing);
      const gradZ = (hD - hU) / (2 * spacing);
      const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);

      // Elevation and steepness based coloring
      const c = this._colorForHeight(h, seaLevel, steepness, this.snowmap[i]);
      col.setXYZ(i, c.r, c.g, c.b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /* ---- private ---- */

  _generateInitialTerrain() {
    const res = this.resolution;

    // Random offsets to make each map unique
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
        // Huge central mountain peak, randomly offset
        const cx = nx - 0.5 + cxOffset;
        const cz = nz - 0.5 + czOffset;
        const distFromCenterSq = cx*cx + cz*cz;
        const mountainShape = Math.max(0, 1.0 - Math.sqrt(distFromCenterSq) * 1.8);
        let h = mountainShape * 45.0;

        // More aggressive, high-frequency ridges with random phase shifts
        h += Math.sin(nx * 5.0 * Math.PI + pX1) * Math.cos(nz * 4.0 * Math.PI + pZ1) * 8.0;
        h += Math.sin(nx * 12.5 * Math.PI + pX2) * Math.cos(nz * 10.2 * Math.PI + pZ2) * 4.5;
        h += Math.sin(nx * 26.0 * Math.PI + pX3) * Math.cos(nz * 22.0 * Math.PI + pZ3) * 2.0;

        // Sharper edge falloff so it meets water
        const edgeX = 1 - Math.pow(2 * nx - 1, 6);
        const edgeZ = 1 - Math.pow(2 * nz - 1, 6);
        h *= Math.min(edgeX, edgeZ);
        
        this.heightmap[z * res + x] = h;
      }
    }
  }

  _colorForHeight(h, seaLevel, steepness = 0, snowAmount = 0) {
    const tmp = new THREE.Color();
    let baseColor;
    
    if (h < seaLevel - 4) {
      baseColor = DEEP_WATER.clone();
    } else if (h < seaLevel - 1) {
      tmp.lerpColors(DEEP_WATER, SHALLOW, (h - (seaLevel - 4)) / 3);
      baseColor = tmp.clone();
    } else if (h < seaLevel + 0.5) {
      tmp.lerpColors(SHALLOW, SAND, (h - (seaLevel - 1)) / 1.5);
      baseColor = tmp.clone();
    } else if (h < seaLevel + 6) {
      tmp.lerpColors(SAND, GRASS_LOW, (h - (seaLevel + 0.5)) / 5.5);
      baseColor = tmp.clone();
    } else if (h < seaLevel + 15) {
      tmp.lerpColors(GRASS_LOW, GRASS_HIGH, (h - (seaLevel + 6)) / 9);
      baseColor = tmp.clone();
    } else if (h < seaLevel + 28) {
      tmp.lerpColors(GRASS_HIGH, ROCK, (h - (seaLevel + 15)) / 13);
      baseColor = tmp.clone();
    } else if (h < seaLevel + 40) {
      tmp.lerpColors(ROCK, SNOW, (h - (seaLevel + 28)) / 12);
      baseColor = tmp.clone();
    } else {
      baseColor = SNOW.clone();
    }

    // Overlay exposed rock if heavily angled 
    if (h > seaLevel + 0.5 && steepness > 0.6) {
      const steepFactor = Math.min((steepness - 0.6) / 0.5, 1.0); // Max rock cover beyond 0.9 steepness
      tmp.lerpColors(baseColor, ROCK, steepFactor);
      baseColor = tmp.clone();
    }

    // Overlay manually painted snow
    if (snowAmount > 0.05) {
      tmp.lerpColors(baseColor, SNOW, Math.min(snowAmount, 1.0));
      return tmp;
    }

    return baseColor;
  }

  shiftGlobalHeight(delta) {
    for (let i = 0; i < this.heightmap.length; i++) {
      this.heightmap[i] += delta;
    }
  }
}
