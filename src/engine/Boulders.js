import * as THREE from 'three';

const BOULDER_VARIANTS = [
  { type: 'icosahedron', detail: 0, color: 0x6e7885 },
  { type: 'icosahedron', detail: 1, color: 0x5a6a7a },
  { type: 'dodecahedron', detail: 0, color: 0x7d858d },
  { type: 'dodecahedron', detail: 0, color: 0x8a929e },
  { type: 'icosahedron', detail: 0, color: 0x4a5a6a },
];

const MAX_BOULDERS = 5000;
const MAX_PER_VARIANT = 1000;

export class Boulders {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.boulders = []; 

    this.material = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true,
    });

    this.variantGeos = BOULDER_VARIANTS.map(v => this._buildVariantGeo(v));

    this.boulderIMs = this.variantGeos.map((geo, i) => {
      const im = new THREE.InstancedMesh(geo, this.material.clone(), MAX_PER_VARIANT);
      const colors = new Float32Array(MAX_PER_VARIANT * 3);
      const varColor = new THREE.Color(BOULDER_VARIANTS[i].color);
      for (let j = 0; j < MAX_PER_VARIANT; j++) {
        colors[j * 3] = varColor.r;
        colors[j * 3 + 1] = varColor.g;
        colors[j * 3 + 2] = varColor.b;
      }
      im.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      im.castShadow = true;
      im.frustumCulled = false;
      // Boulders don't receive shadow to avoid severe self-shadow acne on low-poly faces
      im.count = 0;
      this.group.add(im);
      return im;
    });

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  _buildVariantGeo(v) {
    let geo;
    if (v.type === 'dodecahedron') {
      geo = new THREE.DodecahedronGeometry(1.0, v.detail);
    } else {
      geo = new THREE.IcosahedronGeometry(1.0, v.detail);
    }
    // Submerge it slightly so it looks planted in the dirt
    geo.translate(0, 0.4, 0); 
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  }

  placeCluster(worldX, worldZ, radius, density, seaLevel = 0) {
    // Use a slightly smaller max count than trees per click for huge boulders
    const count = Math.max(1, Math.floor(density * radius * 0.4));

    for (let i = 0; i < count; i++) {
       if (this.boulders.length >= MAX_BOULDERS) break;

       const angle = Math.random() * Math.PI * 2;
       const dist = Math.random() * radius * 0.78;
       const tx = worldX + Math.cos(angle) * dist;
       const tz = worldZ + Math.sin(angle) * dist;

       const { gx, gz } = this.terrain.worldToGrid(tx, tz);
       if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
       const height = this.terrain.getHeight(gx, gz);

       if (height < -0.5) continue; // no boulders fully underwater usually

       const isSnowy = height >= (seaLevel + 28);
       const variantIdx = Math.floor(Math.random() * BOULDER_VARIANTS.length);
       if (this.boulderIMs[variantIdx].count >= MAX_PER_VARIANT) continue;

       // From small pebbles to massive rock formations
       const scaleBasis = 0.2 + Math.pow(Math.random(), 2.5) * 2.0; 
       
       const bData = {
         worldX: tx,
         worldZ: tz,
         height: height,
         scaleX: scaleBasis * (0.6 + Math.random() * 0.8),
         scaleY: scaleBasis * (0.4 + Math.random() * 0.6), // Usually wider than they are tall
         scaleZ: scaleBasis * (0.6 + Math.random() * 0.8),
         rotationX: Math.random() * Math.PI,
         rotationY: Math.random() * Math.PI * 2,
         rotationZ: Math.random() * Math.PI,
         variantIdx,
         isSnowy,
         instanceIdx: this.boulderIMs[variantIdx].count
       };

       this.boulders.push(bData);
       this._updateInstance(bData);
       this.boulderIMs[variantIdx].count++;
    }

    this.boulderIMs.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  _updateInstance(b) {
    const im = this.boulderIMs[b.variantIdx];
    this._dummy.position.set(b.worldX, b.height, b.worldZ);
    this._dummy.rotation.set(b.rotationX, b.rotationY, b.rotationZ);
    this._dummy.scale.set(b.scaleX, b.scaleY, b.scaleZ);
    this._dummy.updateMatrix();
    im.setMatrixAt(b.instanceIdx, this._dummy.matrix);

    const v = BOULDER_VARIANTS[b.variantIdx];
    const targetColor = b.isSnowy ? 0xd0d8dd : v.color;
    this._color.setHex(targetColor);
    im.setColorAt(b.instanceIdx, this._color);
  }

  removeNear(wx, wz, radius) {
    const rSq = radius * radius;
    const toRemove = [];
    
    for (let i = 0; i < this.boulders.length; i++) {
       const b = this.boulders[i];
       const dx = b.worldX - wx;
       const dz = b.worldZ - wz;
       if (dx * dx + dz * dz < rSq) {
          toRemove.push(i);
       }
    }

    if (toRemove.length === 0) return;

    for (let i = toRemove.length - 1; i >= 0; i--) {
       const idx = toRemove[i];
       const b = this.boulders[idx];
       
       const im = this.boulderIMs[b.variantIdx];
       const lastIdx = im.count - 1;
       if (b.instanceIdx < lastIdx) {
          const matrix = new THREE.Matrix4();
          im.getMatrixAt(lastIdx, matrix);
          im.setMatrixAt(b.instanceIdx, matrix);
          
          if (im.instanceColor) {
             const color = new THREE.Color();
             im.getColorAt(lastIdx, color);
             im.setColorAt(b.instanceIdx, color);
          }
          
          const swapped = this.boulders.find(t => t.variantIdx === b.variantIdx && t.instanceIdx === lastIdx);
          if (swapped) swapped.instanceIdx = b.instanceIdx;
       }
       im.count--;
       this.boulders.splice(idx, 1);
    }

    this.boulderIMs.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  updatePositions(seaLevel = 0) {
    let needsUpdate = false;
    for (const b of this.boulders) {
      const { gx, gz } = this.terrain.worldToGrid(b.worldX, b.worldZ);
      const h = this.terrain.getHeight(gx, gz);
      const isSnowy = h >= (seaLevel + 28);

      if (h !== b.height || isSnowy !== b.isSnowy) {
        b.height = h;
        b.isSnowy = isSnowy;
        this._updateInstance(b);
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      this.boulderIMs.forEach(im => {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
    }
  }

  clear() {
    this.boulders = [];
    this.boulderIMs.forEach(im => im.count = 0);
  }

  loadBoulders(data, seaLevel = 0) {
    this.clear();
    for (const d of data) {
       const { gx, gz } = this.terrain.worldToGrid(d.worldX, d.worldZ);
       if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
       const height = this.terrain.getHeight(gx, gz);

       const isSnowy = height >= (seaLevel + 28);
       const bData = {
          worldX: d.worldX,
          worldZ: d.worldZ,
          height: height,
          scaleX: d.scaleX,
          scaleY: d.scaleY,
          scaleZ: d.scaleZ,
          rotationX: d.rotationX,
          rotationY: d.rotationY,
          rotationZ: d.rotationZ,
          variantIdx: d.variantIdx,
          isSnowy,
          instanceIdx: this.boulderIMs[d.variantIdx].count
       };
       this.boulders.push(bData);
       this._updateInstance(bData);
       this.boulderIMs[d.variantIdx].count++;
    }
    this.boulderIMs.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  get count() {
    return this.boulders.length;
  }
}
