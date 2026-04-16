import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural low-poly tree manager using InstancedMesh for high performance.
 */

const TREE_VARIANTS = [
  // Pines — tall & narrow
  { type: 'pine',     trunkH: 0.5, crownH: 1.6, crownR: 0.45, color: 0x2d6b30 },
  { type: 'pine',     trunkH: 0.4, crownH: 1.8, crownR: 0.40, color: 0x1f5c22 },
  { type: 'pine',     trunkH: 0.35, crownH: 1.3, crownR: 0.35, color: 0x276e2a },
  { type: 'pine',     trunkH: 0.55, crownH: 2.0, crownR: 0.50, color: 0x1a5e1d },
  { type: 'pine',     trunkH: 0.30, crownH: 1.1, crownR: 0.30, color: 0x347a37 },
  { type: 'pine',     trunkH: 0.45, crownH: 1.5, crownR: 0.42, color: 0x235f26 },
  // Oaks — shorter & rounder
  { type: 'oak',      trunkH: 0.6, crownH: 1.0, crownR: 0.7,  color: 0x3a8c3f },
  { type: 'oak',      trunkH: 0.7, crownH: 0.8, crownR: 0.8,  color: 0x4a9a4e },
];

const MAX_TREES = 8000;
const MAX_PER_VARIANT = 1000;

export class Trees {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    
    // We store metadata about every tree so we can rebuild/update
    // { worldX, worldZ, scale, variantIdx, instanceIdx }
    this.trees = [];

    // Shared materials
    this.trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c3a1e,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    });

    this.crownMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.0,
      flatShading: true,
      vertexColors: false, // We use instance color instead
    });

    // Create a generic trunk geometry (1 unit high, centered at bottom)
    let baseTrunk = new THREE.CylinderGeometry(1, 1, 1, 6);
    baseTrunk.translate(0, 0.5, 0);
    baseTrunk = baseTrunk.toNonIndexed();
    baseTrunk.computeVertexNormals();
    this.baseTrunkGeo = baseTrunk;

    // Build template geometries for each variant's crown
    this.variantCrownGeos = TREE_VARIANTS.map(v => this._buildVariantCrownGeo(v));

    // Instanced Meshes
    // 1 for trunks (all variants share this, just scaled differently)
    this.trunkIM = new THREE.InstancedMesh(this.baseTrunkGeo, this.trunkMaterial, MAX_TREES);
    this.trunkIM.castShadow = true;
    this.trunkIM.receiveShadow = true;
    this.trunkIM.count = 0;
    this.group.add(this.trunkIM);

    // 8 for crowns (one per variant geometry)
    this.crownIMs = this.variantCrownGeos.map((geo, i) => {
      const im = new THREE.InstancedMesh(geo, this.crownMaterial.clone(), MAX_PER_VARIANT);
      // Pre-allocate instanceColor using the variant's base color to prevent a flash of white
      const colors = new Float32Array(MAX_PER_VARIANT * 3);
      const varColor = new THREE.Color(TREE_VARIANTS[i].color);
      for (let j = 0; j < MAX_PER_VARIANT; j++) {
        colors[j * 3] = varColor.r;
        colors[j * 3 + 1] = varColor.g;
        colors[j * 3 + 2] = varColor.b;
      }
      im.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      im.castShadow = true;
      im.receiveShadow = true;
      im.count = 0;
      this.group.add(im);
      return im;
    });

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  _buildVariantCrownGeo(v) {
    if (v.type === 'pine') {
      const layers = 3;
      const geos = [];
      for (let l = 0; l < layers; l++) {
        const layerScale = 1 - l * 0.25;
        const coneH = v.crownH * 0.45 * layerScale;
        const coneR = v.crownR * layerScale;
        let coneGeo = new THREE.ConeGeometry(coneR, coneH, 7);
        const yOff = v.trunkH + l * coneH * 0.55;
        coneGeo.translate(0, yOff + coneH / 2, 0);
        coneGeo = coneGeo.toNonIndexed();
        coneGeo.computeVertexNormals();
        geos.push(coneGeo);
      }
      return BufferGeometryUtils.mergeGeometries(geos);
    } else {
      let sphereGeo = new THREE.IcosahedronGeometry(v.crownR, 1);
      sphereGeo.translate(0, v.trunkH + v.crownR * 0.7, 0);
      sphereGeo = sphereGeo.toNonIndexed();
      sphereGeo.computeVertexNormals();
      return sphereGeo;
    }
  }

  placeCluster(worldX, worldZ, radius, density, seaLevel = 0) {
    const count = Math.max(1, Math.floor(density * radius * 0.6));

    for (let i = 0; i < count; i++) {
      if (this.trees.length >= MAX_TREES) break;

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.78;
      const tx = worldX + Math.cos(angle) * dist;
      const tz = worldZ + Math.sin(angle) * dist;

      const { gx, gz } = this.terrain.worldToGrid(tx, tz);
      if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
      const height = this.terrain.getHeight(gx, gz);

      if (height < -0.5) continue;

      const isSnowy = height >= (seaLevel + 28);
      let variantIdx;
      if (isSnowy) {
        variantIdx = Math.floor(Math.random() * 6); // Only pines in snow
      } else {
        variantIdx = Math.floor(Math.random() * TREE_VARIANTS.length);
      }
      
      const variant = TREE_VARIANTS[variantIdx];
      if (this.crownIMs[variantIdx].count >= MAX_PER_VARIANT) continue;

      const scale = 0.3 + Math.random() * 0.45;
      const rotation = Math.random() * Math.PI * 2;

      const treeData = {
        worldX: tx,
        worldZ: tz,
        height: height,
        scale,
        rotation,
        variantIdx,
        isSnowy,
        // We'll store the instance index within its specific crownIM
        crownInstanceIdx: this.crownIMs[variantIdx].count,
        // And its global index in the trunkIM
        trunkInstanceIdx: this.trunkIM.count
      };

      this.trees.push(treeData);
      
      // Update Trunks
      this._updateTrunkInstance(treeData);
      this.trunkIM.count++;

      // Update Crowns
      this._updateCrownInstance(treeData);
      this.crownIMs[variantIdx].count++;
    }

    this.trunkIM.instanceMatrix.needsUpdate = true;
    this.crownIMs.forEach(im => {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  _updateTrunkInstance(tree) {
    const v = TREE_VARIANTS[tree.variantIdx];
    this._dummy.position.set(tree.worldX, tree.height, tree.worldZ);
    this._dummy.rotation.y = tree.rotation;
    // Trunk width is fixed at ~0.15 relative to variant, trunk height at variant.trunkH
    // Base trunk geo is 1x1x1 at 0,0.5,0
    this._dummy.scale.set(0.15 * tree.scale, v.trunkH * tree.scale, 0.15 * tree.scale);
    this._dummy.updateMatrix();
    this.trunkIM.setMatrixAt(tree.trunkInstanceIdx, this._dummy.matrix);
  }

  _updateCrownInstance(tree) {
    const im = this.crownIMs[tree.variantIdx];
    this._dummy.position.set(tree.worldX, tree.height, tree.worldZ);
    this._dummy.rotation.y = tree.rotation;
    this._dummy.scale.setScalar(tree.scale);
    this._dummy.updateMatrix();
    im.setMatrixAt(tree.crownInstanceIdx, this._dummy.matrix);

    const v = TREE_VARIANTS[tree.variantIdx];
    // Slightly darker snow color (not pure white) so flat-shaded geometries don't wash out in the strong sun
    const targetColor = tree.isSnowy ? 0xd0d8dd : v.color;
    this._color.setHex(targetColor);
    im.setColorAt(tree.crownInstanceIdx, this._color);
  }

  removeNear(wx, wz, radius) {
    const rSq = radius * radius;
    const toRemove = [];
    
    // Find indices to remove
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const dx = t.worldX - wx;
      const dz = t.worldZ - wz;
      if (dx * dx + dz * dz < rSq) {
        toRemove.push(i);
      }
    }

    if (toRemove.length === 0) return;

    // Remove from back to front to keep indices stable while removing
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const tree = this.trees[idx];
      
      // Swap patterns for InstancedMesh
      this._removeInstance(this.trunkIM, tree.trunkInstanceIdx, 'trunkInstanceIdx');
      this._removeInstance(this.crownIMs[tree.variantIdx], tree.crownInstanceIdx, 'crownInstanceIdx', tree.variantIdx);
      
      this.trees.splice(idx, 1);
    }

    this.trunkIM.instanceMatrix.needsUpdate = true;
    this.crownIMs.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  _removeInstance(im, instanceIdx, idxKey, variantIdx = null) {
    const lastIdx = im.count - 1;
    if (instanceIdx < lastIdx) {
      // Move last instance into the gap
      const matrix = new THREE.Matrix4();
      im.getMatrixAt(lastIdx, matrix);
      im.setMatrixAt(instanceIdx, matrix);
      
      if (im.instanceColor) {
        const color = new THREE.Color();
        im.getColorAt(lastIdx, color);
        im.setColorAt(instanceIdx, color);
      }

      // Update our metadata to point the swapped tree to its new home
      const swappedTree = this.trees.find(t => {
        if (variantIdx !== null) return t.variantIdx === variantIdx && t[idxKey] === lastIdx;
        return t[idxKey] === lastIdx;
      });
      if (swappedTree) swappedTree[idxKey] = instanceIdx;
    }
    im.count--;
  }

  updatePositions(seaLevel = 0) {
    let needsUpdate = false;
    for (const t of this.trees) {
      const { gx, gz } = this.terrain.worldToGrid(t.worldX, t.worldZ);
      const h = this.terrain.getHeight(gx, gz);
      const isSnowy = h >= (seaLevel + 28);

      if (h !== t.height || isSnowy !== t.isSnowy) {
        t.height = h;
        t.isSnowy = isSnowy;
        this._updateTrunkInstance(t);
        this._updateCrownInstance(t);
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      this.trunkIM.instanceMatrix.needsUpdate = true;
      this.crownIMs.forEach(im => {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
    }
  }

  clear() {
    this.trees = [];
    this.trunkIM.count = 0;
    this.crownIMs.forEach(im => im.count = 0);
  }

  loadTrees(treesData, seaLevel = 0) {
    this.clear();
    for (const d of treesData) {
      const { gx, gz } = this.terrain.worldToGrid(d.x, d.z);
      if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
      const height = this.terrain.getHeight(gx, gz);

      const isSnowy = height >= (seaLevel + 28);
      const variantIdx = d.variantIdx;
      
      const treeData = {
        worldX: d.x,
        worldZ: d.z,
        height: height,
        scale: d.scale,
        rotation: Math.random() * Math.PI * 2,
        variantIdx,
        isSnowy,
        crownInstanceIdx: this.crownIMs[variantIdx].count,
        trunkInstanceIdx: this.trunkIM.count
      };

      this.trees.push(treeData);
      this._updateTrunkInstance(treeData);
      this.trunkIM.count++;
      this._updateCrownInstance(treeData);
      this.crownIMs[variantIdx].count++;
    }
    this.trunkIM.instanceMatrix.needsUpdate = true;
    this.crownIMs.forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  get count() {
    return this.trees.length;
  }
}
