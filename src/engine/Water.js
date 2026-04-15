import * as THREE from 'three/webgpu';

export class Water {
  constructor(size = 200, seaLevel = -1) {
    this.size = size;
    this.seaLevel = seaLevel;

    this.geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x1a8fba,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.3,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = seaLevel;
    this.mesh.receiveShadow = true;

  }

  setSeaLevel(level) {
    this.seaLevel = level;
    this.mesh.position.y = level;
  }

  update() {
    // Water stays at a fixed level — no vertex animation
  }
}
