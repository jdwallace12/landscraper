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

  /** Convert world (x, z) → grid indices */
  worldToGrid(wx, wz) {
    const half = this.size / 2;
    const gx = Math.round(((wx + half) / this.size) * (this.resolution - 1));
    const gz = Math.round(((wz + half) / this.size) * (this.resolution - 1));
    return { gx, gz };
  }

  /** Snapshot the heightmap for undo */
  snapshot() {
    return new Float32Array(this.heightmap);
  }

  /** Restore from a snapshot */
  restore(snap) {
    this.heightmap.set(snap);
    this.updateMesh();
  }

  /** Reset terrain to flat (all zeros) */
  reset(seaLevel = 0) {
    this.heightmap.fill(0);
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

      // Elevation-based coloring
      const c = this._colorForHeight(h, seaLevel);
      col.setXYZ(i, c.r, c.g, c.b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /* ---- private ---- */

  _generateInitialTerrain() {
    const res = this.resolution;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const nx = x / res;
        const nz = z / res;
        // Gentle rolling hills using layered sine waves
        let h = 0;
        h += Math.sin(nx * 4.0 * Math.PI) * Math.cos(nz * 3.0 * Math.PI) * 3.0;
        h +=
          Math.sin(nx * 8.5 * Math.PI + 1.3) *
          Math.cos(nz * 7.2 * Math.PI + 0.7) *
          1.5;
        h +=
          Math.sin(nx * 15.0 * Math.PI + 2.7) *
          Math.cos(nz * 13.0 * Math.PI + 4.1) *
          0.5;
        // Edge falloff
        const edgeX = 1 - Math.pow(2 * nx - 1, 4);
        const edgeZ = 1 - Math.pow(2 * nz - 1, 4);
        h *= edgeX * edgeZ;
        this.heightmap[z * res + x] = h;
      }
    }
  }

  _colorForHeight(h, seaLevel) {
    const tmp = new THREE.Color();
    if (h < seaLevel - 4) {
      return DEEP_WATER.clone();
    } else if (h < seaLevel - 1) {
      tmp.lerpColors(DEEP_WATER, SHALLOW, (h - (seaLevel - 4)) / 3);
      return tmp;
    } else if (h < seaLevel + 0.5) {
      tmp.lerpColors(SHALLOW, SAND, (h - (seaLevel - 1)) / 1.5);
      return tmp;
    } else if (h < seaLevel + 6) {
      tmp.lerpColors(SAND, GRASS_LOW, (h - (seaLevel + 0.5)) / 5.5);
      return tmp;
    } else if (h < seaLevel + 15) {
      tmp.lerpColors(GRASS_LOW, GRASS_HIGH, (h - (seaLevel + 6)) / 9);
      return tmp;
    } else if (h < seaLevel + 28) {
      tmp.lerpColors(GRASS_HIGH, ROCK, (h - (seaLevel + 15)) / 13);
      return tmp;
    } else if (h < seaLevel + 40) {
      tmp.lerpColors(ROCK, SNOW, (h - (seaLevel + 28)) / 12);
      return tmp;
    } else {
      return SNOW.clone();
    }
  }

  shiftGlobalHeight(delta) {
    for (let i = 0; i < this.heightmap.length; i++) {
      this.heightmap[i] += delta;
    }
  }
}
