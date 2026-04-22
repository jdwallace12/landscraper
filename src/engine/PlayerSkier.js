import * as THREE from 'three/webgpu';

/**
 * Player-controlled skier for 3rd-person ski mode.
 * Uses WASD/Arrows: A/D steer, W tucks (speed), S brakes.
 */
export class PlayerSkier {
  constructor(terrain) {
    this.terrain = terrain;
    this.mesh = null;
    this.group = new THREE.Group();

    // World position & velocity
    this.wx = 0;
    this.wz = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.heading = 0; // radians, direction the skier faces

    // State
    this.active = false;

    // Input state
    this._keys = { left: false, right: false, lookUp: false, lookDown: false, forward: false, brake: false };

    // Camera pitch (controlled by W/S)
    this.cameraPitch = 0; // radians, positive = look up

    // Smooth height tracking (prevents Y-axis snapping/jitter)
    this._smoothY = 0;

    // Previous state for visual interpolation
    this._prevWx = 0;
    this._prevWz = 0;
    this._prevSmoothY = 0;

    // Pre-allocated vectors (avoid GC micro-pauses from per-frame allocations)
    this._camPosVec = new THREE.Vector3();
    this._lookAtVec = new THREE.Vector3();

    // Trail
    this._trailMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.9 });
    this._trail = null;
    this._trailPoints = [];

    // Shared materials
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.6 }); // Blue jacket
    this._pantsMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 });
    this._skinMat = new THREE.MeshStandardMaterial({ color: 0xf4d4b0, roughness: 0.8 });
    this._skiMat = new THREE.MeshStandardMaterial({ color: 0x00e676, roughness: 0.3, metalness: 0.2 }); // Green skis

    // Bind input handlers
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  /** Spawn the player skier at world position (wx, wz) facing downhill */
  spawn(wx, wz) {
    this.wx = wx;
    this.wz = wz;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.active = true;
    this._trailPoints = [];
    this.angularVelocity = 0;

    // Initialize smooth height at exact terrain height
    const h = this.terrain.getInterpolatedHeight(wx, wz);
    this._smoothY = h;
    this._prevWx = wx;
    this._prevWz = wz;
    this._prevSmoothY = h;

    // Build mesh
    this.mesh = this._buildSkier();
    this.mesh.position.set(wx, h + 0.15, wz);
    this.group.add(this.mesh);

    // Determine initial heading: face downhill using gradient
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const cellSize = size / (res - 1);
    const { gx, gz } = this.terrain.worldToGrid(wx, wz);
    const sampleR = 3;
    const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
    const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
    const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
    const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));
    const gradX = (hR - hL) / (2 * sampleR * cellSize);
    const gradZ = (hD - hU) / (2 * sampleR * cellSize);
    this.heading = Math.atan2(-gradX, -gradZ); // face downhill

    // Trail
    const trailGeo = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(4000 * 3);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this._trail = new THREE.Line(trailGeo, this._trailMat);
    this.group.add(this._trail);

    // Start listening for input
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** Remove the player skier and clean up */
  despawn() {
    this.active = false;
    this._keys = { left: false, right: false, lookUp: false, lookDown: false, forward: false, brake: false };
    this.cameraPitch = 0;
    
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      this.mesh = null;
    }
    if (this._trail) {
      this.group.remove(this._trail);
      this._trail.geometry.dispose();
      this._trail = null;
    }
    this._trailPoints = [];
  }

  /** Run the physics math correctly decoupled from visual rendering */
  update(dt) {
    if (!this.active) return false;

    // Store previous state for interpolation
    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevSmoothY = this._smoothY;

    const gravity = 10.0; // Lowered from 18.0 to prevent aggressive acceleration spikes
    const baseFriction = 0.992; // Lower friction (higher retention) for a longer, silky glide
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const cellSize = size / (res - 1);

    // Grid bounds check
    const { gx, gz } = this.terrain.worldToGrid(this.wx, this.wz);
    if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
      this.active = false;
      return false;
    }

    // Compute terrain gradient
    const sampleR = 3;
    const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
    const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
    const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
    const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));
    const gradX = (hR - hL) / (2 * sampleR * cellSize);
    const gradZ = (hD - hU) / (2 * sampleR * cellSize);

    // Apply gravity along slope
    this.vx -= gradX * gravity * dt;
    this.vz -= gradZ * gravity * dt;

    // --- Weighted Steering (Carving) ---
    const maxTurnAccel = 15.0; // Scaled up slightly to compensate for floating momentum
    const turnDamping = 0.98; // Stabilize gracefully over time (drift instead of snapping!)
    
    if (this._keys.left) this.angularVelocity += maxTurnAccel * dt;
    if (this._keys.right) this.angularVelocity -= maxTurnAccel * dt;
    
    this.angularVelocity *= turnDamping;
    this.heading += this.angularVelocity * dt;

    // Steering force: push velocity towards the heading direction
    this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (this.speed > 0.1) {
      const desiredX = Math.sin(this.heading) * this.speed;
      const desiredZ = Math.cos(this.heading) * this.speed;
      const steerStrength = Math.max(0.5, 2.5 - (this.speed * 0.05)); // Less aggressive snap, more drift!
      
      this.vx += (desiredX - this.vx) * steerStrength * dt;
      this.vz += (desiredZ - this.vz) * steerStrength * dt;
    }

    // Forward push (ArrowUp)
    if (this._keys.forward) {
      const pushForce = 15.0; // Stronger push for flats
      this.vx += Math.sin(this.heading) * pushForce * dt;
      this.vz += Math.cos(this.heading) * pushForce * dt;
    }

    // Camera pitch (W/S keys)
    const pitchSpeed = 1.5; // radians/sec
    if (this._keys.lookUp) this.cameraPitch = Math.min(this.cameraPitch + pitchSpeed * dt, 1.0);
    if (this._keys.lookDown) this.cameraPitch = Math.max(this.cameraPitch - pitchSpeed * dt, -0.5);
    // Gently return to neutral when not pressing
    if (!this._keys.lookUp && !this._keys.lookDown) {
      this.cameraPitch *= 0.92;
    }

    // Friction & Tucking
    let friction = baseFriction;
    if (this._keys.brake) {
      friction = 0.92; // Harder braking
    } else if (this._keys.lookUp) {
      friction = 0.998; // 'W' tucks: less aerodynamic drag
    } else if (this._keys.forward && this.speed > 1.0) {
      friction = 0.996; // reduce drag when actively pushing
    }

    this.vx *= friction;
    this.vz *= friction;
    this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

    // Move
    this.wx += this.vx * dt;
    this.wz += this.vz * dt;

    // Re-check bounds after move
    const { gx: ngx, gz: ngz } = this.terrain.worldToGrid(this.wx, this.wz);
    if (ngx < 0 || ngx >= res || ngz < 0 || ngz >= res) {
      this.active = false;
      return false;
    }

    // Smooth terrain height
    const newH = this.terrain.getInterpolatedHeight(this.wx, this.wz);
    this._smoothY += (newH - this._smoothY) * Math.min(1, 20 * dt);

    return true;
  }

  /** Interpolate visual position between prev and current physics state for sub-frame accuracy */
  interpolateVisuals(alpha, dt) {
    if (!this.active || !this.mesh) return;

    // Position Lerp
    const x = this._prevWx + (this.wx - this._prevWx) * alpha;
    const z = this._prevWz + (this.wz - this._prevWz) * alpha;
    const y = this._prevSmoothY + (this._smoothY - this._prevSmoothY) * alpha;
    this.mesh.position.set(x, y + 0.15, z);

    // Frame-rate independent exponential tracking (~99.9% convergence per sec)
    const smoothFactor = 1 - Math.pow(0.0001, dt);

    // Mesh Rotation
    const targetRot = this.heading;
    let diff = targetRot - this.mesh.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.mesh.rotation.y += diff * smoothFactor; 

    // Lean into the turn
    const targetLean = -(this.angularVelocity || 0) * 0.15;
    if (this._currentLean === undefined) this._currentLean = 0;
    this._currentLean += (targetLean - this._currentLean) * smoothFactor;
    this.mesh.rotation.z = this._currentLean;
    this.mesh.rotation.x = (this.cameraPitch || 0) * 0.5;

    // Trail
    const tp = this._trailPoints;
    const lastIdx = tp.length - 3;
    let addPoint = true;
    if (lastIdx >= 0) {
      const dx = x - tp[lastIdx];
      const dz = z - tp[lastIdx + 2];
      if (dx * dx + dz * dz < 0.09) addPoint = false; // < 0.3 units
    }
    if (addPoint) {
      tp.push(x, y + 0.15, z);
      const maxTrailVerts = 4000;
      if (tp.length > maxTrailVerts * 3) {
        this._trailPoints = tp.slice(tp.length - maxTrailVerts * 3);
      }
      const posAttr = this._trail.geometry.attributes.position;
      const count = Math.min(this._trailPoints.length, maxTrailVerts * 3);
      const offset = this._trailPoints.length - count;
      posAttr.array.set(this._trailPoints.slice(offset, offset + count));
      posAttr.needsUpdate = true;
      this._trail.geometry.setDrawRange(0, count / 3);
    }
  }

  /** Get the chase camera target position and look-at (uses pre-allocated vectors) */
  getCameraTarget(alpha) {
    // Interpolate everything strictly to exactly match visual drawing
    const x = this._prevWx + (this.wx - this._prevWx) * alpha;
    const z = this._prevWz + (this.wz - this._prevWz) * alpha;
    const h = this._prevSmoothY + (this._smoothY - this._prevSmoothY) * alpha;
    
    const camDist = 12;
    const camHeight = 6 + this.cameraPitch * 5; 

    // Use a heavily smoothed camera heading so it doesn't whip around when the skier carves
    if (this.cameraHeading === undefined) this.cameraHeading = this.heading;
    
    // Smoothly track the skier's heading over time
    let diff = this.heading - this.cameraHeading;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.cameraHeading += diff * 0.05; // Extremely slow, smooth tracking (almost locked to mountain gravity path)

    const camX = x - Math.sin(this.cameraHeading) * camDist;
    const camZ = z - Math.cos(this.cameraHeading) * camDist;
    let camY = h + camHeight;

    const terrainHAtCam = this.terrain.getInterpolatedHeight(camX, camZ);
    const minHeightAboveGround = 2.5;
    if (camY < terrainHAtCam + minHeightAboveGround) {
      camY = terrainHAtCam + minHeightAboveGround;
    }

    const lookY = h + 1.2 + this.cameraPitch * 8;

    this._camPosVec.set(camX, camY, camZ);
    this._lookAtVec.set(x, lookY, z);
    return { position: this._camPosVec, lookAt: this._lookAtVec };
  }

  // ---- Input handlers ----
  _onKeyDown(e) {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
    switch (e.key) {
      case 'ArrowLeft':    this._keys.left = true; break;
      case 'ArrowRight':   this._keys.right = true; break;
      case 'ArrowUp':      this._keys.forward = true; break;
      case 'ArrowDown':    this._keys.brake = true; break;
      case 'w': case 'W':  this._keys.lookUp = true; break;
      case 's': case 'S':  this._keys.lookDown = true; break;
    }
  }

  _onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft':    this._keys.left = false; break;
      case 'ArrowRight':   this._keys.right = false; break;
      case 'ArrowUp':      this._keys.forward = false; break;
      case 'ArrowDown':    this._keys.brake = false; break;
      case 'w': case 'W':  this._keys.lookUp = false; break;
      case 's': case 'S':  this._keys.lookDown = false; break;
    }
  }

  // ---- Skier mesh builder (player-colored variant) ----
  _buildSkier() {
    const group = new THREE.Group();

    // Torso
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.22, 0.1),
      this._bodyMat
    );
    torso.position.y = 0.32;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      this._skinMat
    );
    head.position.y = 0.5;
    head.castShadow = true;
    group.add(head);

    // Helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      this._bodyMat
    );
    helmet.position.y = 0.5;
    helmet.castShadow = true;
    group.add(helmet);

    // Legs
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.20, 0.06),
        this._pantsMat
      );
      leg.position.set(side * 0.04, 0.12, 0);
      leg.castShadow = true;
      group.add(leg);
    }

    // Skis
    for (const side of [-1, 1]) {
      const ski = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.03, 0.7),
        this._skiMat
      );
      ski.position.set(side * 0.09, 0.015, 0);
      ski.castShadow = true;
      group.add(ski);
    }

    // Poles
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4),
        this._skiMat
      );
      pole.position.set(side * 0.18, 0.22, 0);
      pole.rotation.z = side * 0.2;
      group.add(pole);
    }

    group.scale.setScalar(0.8); // Slightly larger than AI skiers
    return group;
  }
}
