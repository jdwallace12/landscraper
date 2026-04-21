import * as THREE from "three/webgpu";

export class Terrain {
  /**
   * @param {number} size
   * @param {number} resolution
   */
  constructor(size = 200, resolution = 256) {
    this.size = size;
    this.resolution = resolution;
    this.heightmap = new Float32Array(resolution * resolution);
    this.snowmap = new Float32Array(resolution * resolution);

    this.geometry = new THREE.PlaneGeometry(
      size,
      size,
      resolution - 1,
      resolution - 1,
    );
    this.geometry.rotateX(-Math.PI / 2); // lay flat

    const count = this.geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.05,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Initialize Worker
    this.worker = new Worker(new URL('./TerrainWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = this._onWorkerMessage.bind(this);

    // Track tool state from worker
    this._toolState = {};

    this.worker.postMessage({
      type: 'init',
      size: this.size,
      resolution: this.resolution
    });
  }

  /* ---- Worker Handling ---- */

  _onWorkerMessage(e) {
    const msg = e.data;
    if (msg.heightmap) this.heightmap.set(msg.heightmap);
    if (msg.snowmap) this.snowmap.set(msg.snowmap);
    if (msg.toolState) this._toolState = msg.toolState;

    if (msg.colors || msg.heightmap) {
      this._applyBuffersToMesh(msg.heightmap, msg.colors);
    }
  }

  _applyBuffersToMesh(heights, colors) {
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;

    if (heights) {
      for (let i = 0; i < pos.count; i++) {
          pos.setY(i, heights[i]);
      }
      pos.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
    
    if (colors) {
      col.array.set(colors);
      col.needsUpdate = true;
    }
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

  snapshot() {
    return {
      heightmap: new Float32Array(this.heightmap),
      snowmap: new Float32Array(this.snowmap)
    };
  }

  restore(snap) {
    if (snap.heightmap) this.heightmap.set(snap.heightmap);
    if (snap.snowmap) this.snowmap.set(snap.snowmap);
    
    this.worker.postMessage({
      type: 'init',
      size: this.size,
      resolution: this.resolution,
      heightmap: this.heightmap,
      snowmap: this.snowmap
    });
  }

  reset(seaLevel = 0) {
    this.worker.postMessage({ type: 'reset' });
  }

  shiftGlobalHeight(delta) {
    this.worker.postMessage({ type: 'shiftGlobal', delta });
  }

  /** Paint / Sculpt asynchronously via Worker */
  sculpt(toolName, cx, cz, radius, strength, isStart) {
    this.worker.postMessage({
      type: 'sculpt',
      toolName,
      cx,
      cz,
      radius,
      strength,
      isStart,
      toolState: this._toolState
    });
  }

  /** Update coloring based on sea level */
  updateMesh(seaLevel = 0) {
    this.worker.postMessage({ type: 'updateSeaLevel', seaLevel });
  }
}
