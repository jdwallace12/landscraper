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

    // Load tileable textures for Splatting (with Vite BASE_URL resolution mapped correctly)
    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL || '/';
    const tGrass = loader.load(base + 'textures/moss.png');
    const tRock = loader.load(base + 'textures/rock.png');
    const tSnow = loader.load(base + 'textures/snow.png');
    const tSand = loader.load(base + 'textures/sand.png');

    [tGrass, tRock, tSnow, tSand].forEach(t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
    });

    // Material with vertex colors serving as texture-blend weights
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.05,
      map: tGrass // Fakes out WebGLProgram compiler to permanently supply the 'vUv' varying attribute for texture mapping
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.tGrass = { value: tGrass };
      shader.uniforms.tRock = { value: tRock };
      shader.uniforms.tSnow = { value: tSnow };
      shader.uniforms.tSand = { value: tSand };
      shader.uniforms.textureScale = { value: 60.0 };

      // Pass world position from vertex to fragment for seamless grid tiling decoupled from UV arrays
      shader.vertexShader = `
        varying vec3 vTilePos;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vTilePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

      // Inject custom texture blending samplers
      shader.fragmentShader = `
        uniform sampler2D tGrass;
        uniform sampler2D tRock;
        uniform sampler2D tSnow;
        uniform sampler2D tSand;
        uniform float textureScale;
        varying vec3 vTilePos;
      ` + shader.fragmentShader;

      // Hijack the color calculation to intercept the vertex color weight map WITHOUT multiplying it natively
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        // Calculate weighting from the CPU vertex-color emission
        float wGrass = vColor.r;
        float wRock = vColor.g;
        float wSnow = vColor.b;
        float wSand = clamp(1.0 - (wGrass + wRock + wSnow), 0.0, 1.0);

        vec2 splatUV = vTilePos.xz / textureScale;
        vec4 texGrass = texture2D(tGrass, splatUV);
        vec4 texRock  = texture2D(tRock, splatUV);
        vec4 texSnow  = texture2D(tSnow, splatUV);
        vec4 texSand  = texture2D(tSand, splatUV);

        // Mix the hyper-realistic textures together natively in real-time
        vec4 blendedColor = texGrass * wGrass + texRock * wRock + texSnow * wSnow + texSand * wSand;
        
        diffuseColor = vec4(blendedColor.rgb, diffuseColor.a);
        `
      );
    };

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

      // Elevation and steepness based texturing weights
      const w = this._weightsForHeight(h, seaLevel, steepness);
      col.setXYZ(i, w.r, w.g, w.b);
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
        // Huge central mountain peak
        const cx = nx - 0.5;
        const cz = nz - 0.5;
        const distFromCenterSq = cx*cx + cz*cz;
        const mountainShape = Math.max(0, 1.0 - Math.sqrt(distFromCenterSq) * 1.8);
        let h = mountainShape * 45.0;

        // More aggressive, high-frequency ridges
        h += Math.sin(nx * 5.0 * Math.PI) * Math.cos(nz * 4.0 * Math.PI) * 8.0;
        h += Math.sin(nx * 12.5 * Math.PI + 1.3) * Math.cos(nz * 10.2 * Math.PI + 0.7) * 4.5;
        h += Math.sin(nx * 26.0 * Math.PI + 2.7) * Math.cos(nz * 22.0 * Math.PI + 4.1) * 2.0;

        // Sharper edge falloff so it meets water
        const edgeX = 1 - Math.pow(2 * nx - 1, 6);
        const edgeZ = 1 - Math.pow(2 * nz - 1, 6);
        h *= Math.min(edgeX, edgeZ);
        
        this.heightmap[z * res + x] = h;
      }
    }
  }

  _weightsForHeight(h, seaLevel, steepness = 0) {
    let r = 0, g = 0, b = 0; // r: grass, g: rock, b: snow (remainder is sand)
    
    if (h < seaLevel + 0.5) {
      // Under water -> Sand (leaves r,g,b as 0.0)
    } else if (h < seaLevel + 6) {
      // Sand fading to Grass
      r = (h - (seaLevel + 0.5)) / 5.5;
    } else if (h < seaLevel + 12) {
      // Solid grass (moss)
      r = 1.0;
    } else if (h < seaLevel + 22) {
      // Moss fading directly to Snow (skipping static rock bands)
      const t = (h - (seaLevel + 12)) / 10;
      r = 1.0 - t;
      b = t;
    } else {
      // Solid Snow from lower down and all the way up
      b = 1.0;
    }

    // Steepness override (Exposes rock texture dynamically ONLY on extremely sharp cliffs)
    if (h > seaLevel + 4 && steepness > 0.75) {
      const steepFactor = Math.min((steepness - 0.75) / 0.5, 1.0);
      r *= (1.0 - steepFactor);
      b *= (1.0 - steepFactor);
      g = Math.min(1.0, g + steepFactor); 

      // Normalize bounds just safely
      const sum = r + g + b;
      if(sum > 1.0) {
          r /= sum; g /= sum; b /= sum;
      }
    }

    return { r, g, b };
  }

  shiftGlobalHeight(delta) {
    for (let i = 0; i < this.heightmap.length; i++) {
      this.heightmap[i] += delta;
    }
  }
}
