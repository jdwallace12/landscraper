import * as THREE from 'three';

export class Water {
  constructor(size = 200, seaLevel = -1) {
    this.size = size;
    this.seaLevel = seaLevel;

    this.geometry = new THREE.PlaneGeometry(size, size, 128, 128);
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

    this._time = 0;
    this._basePositions = new Float32Array(this.geometry.attributes.position.array);
  }

  setSeaLevel(level) {
    this.seaLevel = level;
    this.mesh.position.y = level;
  }

  update(dt) {
    this._time += dt;
    const pos = this.geometry.attributes.position;
    const base = this._basePositions;

    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const bz = base[i * 3 + 2];
      // gentle waves
      const wave = Math.sin(bx * 0.15 + this._time * 1.2) * 0.15
                 + Math.cos(bz * 0.12 + this._time * 0.9) * 0.1;
      pos.setY(i, wave);
    }
    pos.needsUpdate = true;
  }
}
