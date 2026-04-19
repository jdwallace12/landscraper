import * as THREE from 'three/webgpu';

export class Clouds {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.visible = false;
    
    // Cloud meshes
    const cloudGeo = new THREE.SphereGeometry(1, 16, 16);
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      roughness: 1.0,
      flatShading: true,
      fog: true
    });
    
    // Max 1000 clouds
    this.cloudMeshes = new THREE.InstancedMesh(cloudGeo, this.cloudMat, 1000);
    this.cloudMeshes.castShadow = true;
    this.cloudMeshes.receiveShadow = true;
    this.group.add(this.cloudMeshes);
    
    // Particles
    this.particleCount = 5000;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    const origins = new Float32Array(this.particleCount * 3);
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    this.geometry.setAttribute('origin', new THREE.BufferAttribute(origins, 3));
    
    this.particleMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.8,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    
    this.particlesParams = { positions, velocities, origins };

    this.mesh = new THREE.Points(this.geometry, this.particleMat);
    this.group.add(this.mesh);
    
    this.cloudsData = [];
  }

  updatePositions(seaLevel = 0) {
    this.cloudsData = [];
    const size = this.terrain.size;
    const res = this.terrain.resolution;
    const half = size / 2;
    
    // Sample terrain for peaks
    for (let gz = 0; gz < res; gz += 6) {
      for (let gx = 0; gx < res; gx += 6) {
        const idx = gz * res + gx;
        const h = this.terrain.heightmap[idx];
        if (h > seaLevel + 35) { // Snow peaks
            // 15% chance to spawn a cloud per 6x6 grid chunk above snowline
            if (Math.random() < 0.15) {
                const wx = (gx / (res - 1)) * size - half;
                const wz = (gz / (res - 1)) * size - half;
                
                const cy = h + 15 + Math.random() * 10;
                
                const scaleX = 10 + Math.random() * 15;
                const scaleY = 3 + Math.random() * 5;
                const scaleZ = 10 + Math.random() * 15;
                
                this.cloudsData.push({
                    x: wx, y: cy, z: wz,
                    sx: scaleX, sy: scaleY, sz: scaleZ
                });
            }
        }
      }
    }
    
    const dummy = new THREE.Object3D();
    this.cloudMeshes.count = Math.min(this.cloudsData.length, 1000);
    for(let i=0; i<this.cloudMeshes.count; i++) {
        const c = this.cloudsData[i];
        dummy.position.set(c.x, c.y, c.z);
        dummy.scale.set(c.sx, c.sy, c.sz);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.updateMatrix();
        this.cloudMeshes.setMatrixAt(i, dummy.matrix);
    }
    this.cloudMeshes.instanceMatrix.needsUpdate = true;
    
    // Setup particles assigned to clouds
    if (this.cloudMeshes.count > 0) {
        this.mesh.visible = true;
        const { positions, velocities, origins } = this.particlesParams;
        for(let i=0; i<this.particleCount; i++) {
            const cloud = this.cloudsData[Math.floor(Math.random() * this.cloudMeshes.count)];
            
            const px = cloud.x + (Math.random() - 0.5) * cloud.sx * 1.5;
            const py = cloud.y - 2 - Math.random() * 30; // Fall starting height
            const pz = cloud.z + (Math.random() - 0.5) * cloud.sz * 1.5;
            
            positions[i*3] = px;
            positions[i*3+1] = py;
            positions[i*3+2] = pz;
            
            origins[i*3] = cloud.y - Math.random() * 2; // Resets randomly from bottom of cloud
            
            velocities[i*3] = (Math.random() - 0.5) * 1.5;
            velocities[i*3+1] = - (Math.random() * 6 + 6);
            velocities[i*3+2] = (Math.random() - 0.5) * 1.5;
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.velocity.needsUpdate = true;
        this.geometry.attributes.origin.needsUpdate = true;
    } else {
        this.mesh.visible = false;
    }
  }

  toggle(isVisible) {
    this.group.visible = isVisible;
  }

  update(dt) {
    if (!this.group.visible || this.cloudMeshes.count === 0) return;
    
    const positions = this.geometry.attributes.position.array;
    const velocities = this.geometry.attributes.velocity.array;
    const origins = this.geometry.attributes.origin.array;
    
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      
      // If it falls ~35 units below its origin
      if (positions[i * 3 + 1] < origins[i*3] - 35) {
         positions[i * 3 + 1] = origins[i*3];
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    
    // Slow drifting animation for clouds could go here...
    // But instancedMesh updating every frame is expensive, let's leave them static for now.
  }
}
