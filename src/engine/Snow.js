import * as THREE from 'three';

export class Snow {
  constructor(size = 400) {
    this.size = size;
    this.group = new THREE.Group();
    
    this.particleCount = 15000;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    
    // Spread snow uniformly across the size Volume
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * this.size;
      positions[i * 3 + 1] = Math.random() * 100; // Height 0 to 100
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.size;
      
      velocities[i * 3] = (Math.random() - 0.5) * 2; // Wind X
      velocities[i * 3 + 1] = - (Math.random() * 5 + 5); // Fall speed Y
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2; // Wind Z
    }
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.group.add(this.mesh);
    this.group.visible = false; // default off
    
    this.isSnowing = false;
  }

  toggle(isSnowing) {
    this.isSnowing = isSnowing;
    this.group.visible = isSnowing;
  }

  update(dt) {
    if (!this.isSnowing) return;
    
    const positions = this.geometry.attributes.position.array;
    const velocities = this.geometry.attributes.velocity.array;
    
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt; // Fall
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      
      // Reset if below ground
      if (positions[i * 3 + 1] < -10) {
        positions[i * 3 + 1] = 100; // back up high
        positions[i * 3] = (Math.random() - 0.5) * this.size;
        positions[i * 3 + 2] = (Math.random() - 0.5) * this.size;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
