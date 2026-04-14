import * as THREE from 'three';

/**
 * Procedural low-poly tree generator and manager.
 * Creates stylized pine/deciduous trees placed on the terrain.
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

export class Trees {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.trees = []; // { mesh, worldX, worldZ }

    // Shared materials
    this.trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c3a1e,
      roughness: 0.9,
      metalness: 0.0,
    });
  }

  /** Place a cluster of trees around the given world position */
  placeCluster(worldX, worldZ, radius, density, seaLevel = 0) {
    const count = Math.max(1, Math.floor(density * radius * 0.6));

    for (let i = 0; i < count; i++) {
      // Random position within radius
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.78; // world-unit radius
      const tx = worldX + Math.cos(angle) * dist;
      const tz = worldZ + Math.sin(angle) * dist;

      // Get terrain height at this point
      const { gx, gz } = this.terrain.worldToGrid(tx, tz);
      if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
      const height = this.terrain.getHeight(gx, gz);

      // Don't place trees in water (allow on snow now!)
      if (height < -0.5) continue;

      const isSnowy = height >= (seaLevel + 28);
      
      // Pick a random variant
      let variantIdx = Math.floor(Math.random() * TREE_VARIANTS.length);
      
      // Force mostly pine trees (indices 0-5) when on snow
      if (isSnowy && TREE_VARIANTS[variantIdx].type !== 'pine' && Math.random() < 0.9) {
          variantIdx = Math.floor(Math.random() * 6); 
      }
      
      const variant = TREE_VARIANTS[variantIdx];
      const scale = 0.3 + Math.random() * 0.45;
      const tree = this._createTree(variant, scale, isSnowy);

      tree.position.set(tx, height, tz);
      tree.rotation.y = Math.random() * Math.PI * 2;

      this.group.add(tree);
      this.trees.push({ mesh: tree, worldX: tx, worldZ: tz, scale, variantIdx });
    }
  }

  /** Remove trees within a world-space radius of (wx, wz) */
  removeNear(wx, wz, radius) {
    const rSq = radius * radius;
    this.trees = this.trees.filter(t => {
      const dx = t.worldX - wx;
      const dz = t.worldZ - wz;
      if (dx * dx + dz * dz < rSq) {
        this.group.remove(t.mesh);
        t.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material && child.material !== this.trunkMaterial) child.material.dispose();
        });
        return false;
      }
      return true;
    });
  }

  /** Update tree Y positions after terrain changes */
  updatePositions(seaLevel = 0) {
    for (const t of this.trees) {
      const { gx, gz } = this.terrain.worldToGrid(t.worldX, t.worldZ);
      const h = this.terrain.getHeight(gx, gz);
      t.mesh.position.y = h;
      
      const isSnowy = h >= (seaLevel + 28);
      const targetColor = isSnowy ? 0xeaeafa : TREE_VARIANTS[t.variantIdx].color;
      
      t.mesh.traverse(child => {
        if (child.material && child.material !== this.trunkMaterial) {
          if (child.material.color.getHex() !== targetColor) {
            child.material.color.setHex(targetColor);
          }
        }
      });
    }
  }

  /** Remove all trees */
  clear() {
    for (const t of this.trees) {
      this.group.remove(t.mesh);
      t.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material && child.material !== this.trunkMaterial) child.material.dispose();
      });
    }
    this.trees = [];
  }

  /** Load trees from serialized data array */
  loadTrees(treesData, seaLevel = 0) {
    for (const t of treesData) {
      const { gx, gz } = this.terrain.worldToGrid(t.x, t.z);
      if (gx < 0 || gx >= this.terrain.resolution || gz < 0 || gz >= this.terrain.resolution) continue;
      const height = this.terrain.getHeight(gx, gz);

      const variant = TREE_VARIANTS[t.variantIdx];
      const isSnowy = height >= (seaLevel + 28);
      const tree = this._createTree(variant, t.scale, isSnowy);

      tree.position.set(t.x, height, t.z);
      tree.rotation.y = Math.random() * Math.PI * 2;

      this.group.add(tree);
      this.trees.push({ mesh: tree, worldX: t.x, worldZ: t.z, scale: t.scale, variantIdx: t.variantIdx });
    }
  }

  /** Get the total tree count */
  get count() {
    return this.trees.length;
  }

  _createTree(variant, scale, isSnowy = false) {
    const group = new THREE.Group();

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, variant.trunkH * scale, 6);
    trunkGeo.translate(0, (variant.trunkH * scale) / 2, 0);
    const trunk = new THREE.Mesh(trunkGeo, this.trunkMaterial);
    trunk.castShadow = true;
    group.add(trunk);

    // Crown
    const crownMat = new THREE.MeshStandardMaterial({
      color: isSnowy ? 0xeaeafa : variant.color,
      roughness: 0.8,
      metalness: 0.0,
      flatShading: true,
    });

    if (variant.type === 'pine') {
      // Layered cones for pine
      const layers = 3;
      for (let l = 0; l < layers; l++) {
        const layerScale = 1 - l * 0.25;
        const coneH = variant.crownH * scale * 0.45 * layerScale;
        const coneR = variant.crownR * scale * layerScale;
        const coneGeo = new THREE.ConeGeometry(coneR, coneH, 7);
        const yOff = variant.trunkH * scale + l * coneH * 0.55;
        coneGeo.translate(0, yOff + coneH / 2, 0);
        const cone = new THREE.Mesh(coneGeo, crownMat);
        cone.castShadow = true;
        group.add(cone);
      }
    } else {
      // Rounded sphere for deciduous
      const sphereGeo = new THREE.IcosahedronGeometry(variant.crownR * scale, 1);
      sphereGeo.translate(0, variant.trunkH * scale + variant.crownR * scale * 0.7, 0);
      const sphere = new THREE.Mesh(sphereGeo, crownMat);
      sphere.castShadow = true;
      group.add(sphere);
    }

    return group;
  }
}
