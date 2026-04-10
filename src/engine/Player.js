import * as THREE from 'three';

export class Player {
  constructor(terrain, sceneManager) {
    this.terrain = terrain;
    this.sceneManager = sceneManager;
    
    this.active = false;
    this.wx = 0;
    this.wz = 0;
    this.vz = 0;
    this.speed = 0;
    this.turnSteer = 0;

    // Advanced smoothing constraints for buttery-camera and mesh transitions
    this.cameraTargetPos = new THREE.Vector3();
    this.cameraCurrentLook = new THREE.Vector3();
    this.skierModelRotation = 0;
    
    // Bind keys
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') this.turnSteer = 1; // 1 = Left
      if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') this.turnSteer = -1; // -1 = Right
      if (e.key === 'Escape') this.stop();
    });
    
    window.addEventListener('keyup', (e) => {
      if (!this.active) return;
      if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') this.turnSteer = 0;
      if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') this.turnSteer = 0;
    });

    // Helper overlay graphic to remind user how to exit
    this.overlay = document.createElement('div');
    this.overlay.style.position = 'absolute';
    this.overlay.style.top = '20px';
    this.overlay.style.left = '50%';
    this.overlay.style.transform = 'translateX(-50%)';
    this.overlay.style.color = 'white';
    this.overlay.style.fontSize = '24px';
    this.overlay.style.fontWeight = 'bold';
    this.overlay.style.textShadow = '0 2px 4px rgba(0,0,0,0.8)';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.style.display = 'none';
    this.overlay.style.textAlign = 'center';
    this.overlay.innerHTML = '🏂 Third Person Skiing! <br><span style="font-size:16px;">[A/D or Arrows] Steer | [ESC] Exit</span>';
    document.body.appendChild(this.overlay);
  }

  start(wx, wz) {
    if (this.active) return;
    this.active = true;
    this.wx = wx;
    this.wz = wz;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.turnSteer = 0;
    
    // Snap the mathematical camera anchors down instantly to completely avoid "flying" from across the map
    this.cameraTargetPos.set(wx, 100, wz); 
    this.cameraCurrentLook.set(wx, 50, wz);
    this.skierModelRotation = 0;

    // Create skier mesh if it doesn't exist
    if (!this.mesh) {
      this.mesh = new THREE.Group();
      
      // Body
      const bodyGeo = new THREE.BoxGeometry(0.8, 1.4, 0.8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.6 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.7;
      this.mesh.add(body);
      
      // Skis
      const skiGeo = new THREE.BoxGeometry(0.2, 0.05, 2.2);
      const skiMat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
      
      const skiL = new THREE.Mesh(skiGeo, skiMat);
      skiL.position.set(-0.35, 0.05, 0);
      
      const skiR = new THREE.Mesh(skiGeo, skiMat);
      skiR.position.set(0.35, 0.05, 0);
      
      this.mesh.add(skiL);
      this.mesh.add(skiR);
      
      this.sceneManager.add(this.mesh);
    }
    this.mesh.visible = true;

    // Save camera state
    this.savedCameraPos = this.sceneManager.camera.position.clone();
    this.savedTarget = this.sceneManager.controls.target.clone();
    
    // Disable orbit controls
    this.sceneManager.controls.enabled = false;
    this.overlay.style.display = 'block';
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.sceneManager.controls.enabled = true;
    this.overlay.style.display = 'none';
    if (this.mesh) this.mesh.visible = false;

    // Restore camera smoothly
    this.sceneManager.camera.position.copy(this.savedCameraPos);
    this.sceneManager.controls.target.copy(this.savedTarget);
  }

  update(dt) {
    if (!this.active) return;

    // Evaluate steepness under skis
    const gx = Math.round(((this.wx + this.terrain.size / 2) / this.terrain.size) * (this.terrain.resolution - 1));
    const gz = Math.round(((this.wz + this.terrain.size / 2) / this.terrain.size) * (this.terrain.resolution - 1));
    
    const hL = this.terrain.getHeight(gx - 1, gz);
    const hR = this.terrain.getHeight(gx + 1, gz);
    const hU = this.terrain.getHeight(gx, gz - 1);
    const hD = this.terrain.getHeight(gx, gz + 1);

    const spacing = this.terrain.size / (this.terrain.resolution - 1);
    const gradX = (hL - hR) / (2 * spacing);
    const gradZ = (hU - hD) / (2 * spacing);

    // Gravity calculation
    const gravity = 25.0;
    const friction = 0.98; // Keeps speed up, but bleeds eventually if flat

    this.vx += gradX * gravity * dt;
    this.vz += gradZ * gravity * dt;

    this.vx *= friction;
    this.vz *= friction;

    // Player Steer physics
    this.speed = Math.sqrt(this.vx*this.vx + this.vz*this.vz);
    if (this.speed > 0.5 && this.turnSteer !== 0) {
      // Rotate velocity vector
      const turnAmount = this.turnSteer * 3.0 * dt; // Steer radiants per sec
      const cosTurn = Math.cos(turnAmount);
      const sinTurn = Math.sin(turnAmount);
      
      const nvx = this.vx * cosTurn - this.vz * sinTurn;
      const nvz = this.vx * sinTurn + this.vz * cosTurn;
      
      // Carve braking (turning sheds a tiny bit of momentum)
      this.vx = nvx * 0.97;
      this.vz = nvz * 0.97;
    }

    // Apply movement
    this.wx += this.vx * dt;
    this.wz += this.vz * dt;

    // Bounds check
    const half = this.terrain.size / 2;
    if (this.wx < -half || this.wx > half || this.wz < -half || this.wz > half) {
      this.stop(); // Stop if you hit the map edge
      return;
    }

    const h = this.terrain.getInterpolatedHeight(this.wx, this.wz);

    // Smooth camera look target
    let lookDirX = this.vx;
    let lookDirZ = this.vz;
    // Default downhill if totally stopped or extremely slow
    if (this.speed < 1.0) {
      lookDirX = gradX;
      lookDirZ = gradZ;
    }

    // Normalize
    let len = Math.sqrt(lookDirX*lookDirX + lookDirZ*lookDirZ);
    if (len < 0.001) {
       lookDirX = 0;
       lookDirZ = 1;
       len = 1;
    }
    lookDirX /= len;
    lookDirZ /= len;

    // Smooth the visual Skier model rotation natively using radial interpolation
    const targetRotationY = Math.atan2(lookDirX, lookDirZ);
    
    // Angular rotation fix natively jumping the -PI to PI boundaries elegantly
    let diff = targetRotationY - this.skierModelRotation;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.skierModelRotation += diff * 8.0 * dt; 

    // Apply exact frame properties visually
    this.mesh.position.set(this.wx, h, this.wz);
    this.mesh.rotation.y = this.skierModelRotation;
    
    // Lean dynamically when carving at speed (but interpolated cleanly!)
    let targetLean = 0;
    if (this.speed > 0.5 && this.turnSteer !== 0) {
       targetLean = -this.turnSteer * 0.35; 
    }
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, targetLean, 10.0 * dt);

    // Third-person camera positioning (Back and Above)
    const camDistance = 18.0;
    const camHeightOffset = 25.5; 
    
    // Calculate the absolute rigid mathematical vector the camera WANTS to be in
    this.cameraTargetPos.set(
      this.wx - lookDirX * camDistance, 
      h + camHeightOffset, 
      this.wz - lookDirZ * camDistance
    );
    
    // Lerp the TRUE physical camera seamlessly towards the target anchor neutralizing geometry bumps
    this.sceneManager.camera.position.lerp(this.cameraTargetPos, 6.0 * dt);
    
    // Do exactly the same thing structurally for the camera's invisible lens focal point
    // We lock it rigidly onto the physical character's vertical frame so they are never lost regardless of zoom scope!
    const idealLook = new THREE.Vector3(this.wx, h + 2.0, this.wz);
    this.cameraCurrentLook.lerp(idealLook, 12.0 * dt);
    
    this.sceneManager.camera.lookAt(this.cameraCurrentLook);
  }
}
