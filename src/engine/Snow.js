import * as THREE from 'three';

/**
 * Snow particle system.
 * Optimized with GPU-side animation via a custom shader to eliminate CPU loops.
 */
export class Snow {
  constructor(size = 400) {
    this.size = size;
    this.group = new THREE.Group();
    
    this.particleCount = 10000; // Can handle more now that it's on GPU
    this.geometry = new THREE.BufferGeometry();
    
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    const randoms = new Float32Array(this.particleCount);
    
    for (let i = 0; i < this.particleCount; i++) {
      // Seed positions
      positions[i * 3 + 0] = (Math.random() - 0.5) * this.size;
      positions[i * 3 + 1] = Math.random() * 110 - 10; // -10 to 100
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.size;
      
      // Velocities (stored as attributes for shader)
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 2; 
      velocities[i * 3 + 1] = - (Math.random() * 5 + 5); 
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;

      randoms[i] = Math.random();
    }
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    this.geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: this.size },
        uPointSize: { value: 0.3 }
      },
      vertexShader: `
        attribute vec3 velocity;
        attribute float random;
        uniform float uTime;
        uniform float uSize;
        uniform float uPointSize;
        
        void main() {
          vec3 pos = position;
          
          // Animate position based on initial position, velocity, and time
          // We use mod to loop the particles within a 110-unit vertical range
          float heightRange = 110.0;
          pos += velocity * uTime;
          
          // Wrap Y position
          // Using fractional part to keep it in range
          pos.y = mod(pos.y + 10.0, heightRange) - 10.0;
          
          // Wrap X and Z as well if they drift too far out of bounds
          // (Initial pos is already in [-size/2, size/2])
          float halfSize = uSize * 0.5;
          pos.x = mod(pos.x + halfSize, uSize) - halfSize;
          pos.z = mod(pos.z + halfSize, uSize) - halfSize;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uPointSize * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        void main() {
          // Circular point
          if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, 0.8);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.group.add(this.mesh);
    this.group.visible = false;
    
    this.isSnowing = false;
    this.time = 0;
  }

  toggle(isSnowing) {
    this.isSnowing = isSnowing;
    this.group.visible = isSnowing;
  }

  update(dt) {
    if (!this.isSnowing) return;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }
}
