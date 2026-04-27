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
    this.y = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.speed = 0;
    this.heading = 0; // radians, direction the skier faces

    // State
    this.active = false;
    this.grounded = true;

    // Input state
    this._keys = { left: false, right: false, lookUp: false, lookDown: false, forward: false, brake: false };

    // Camera pitch (controlled by W/S)
    this.cameraPitch = 0; // radians, positive = look up

    // Smooth height tracking (prevents Y-axis snapping/jitter)
    this._prevY = 0;

    // Previous state for visual interpolation
    this._prevWx = 0;
    this._prevWz = 0;
    this._prevY = 0;

    // Chairlift State
    this.state = 'skiing'; // 'skiing', 'waiting', 'riding'
    this.targetLine = null;
    this.chair = null;
    this.targetStation = null;
    this._waitingTime = 0;

    // Pre-allocated vectors (avoid GC micro-pauses from per-frame allocations)
    this._camPosVec = new THREE.Vector3();
    this._lookAtVec = new THREE.Vector3();

    // Trail
    this._trailMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.9 });
    this._trail = null;
    this._trailPoints = [];

    // Shared materials
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0xff69b4, roughness: 0.6 }); // Pink jacket
    this._pantsMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 });
    this._skinMat = new THREE.MeshStandardMaterial({ color: 0xf4d4b0, roughness: 0.8 });
    this._skiMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.2 }); // Yellow skis

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
    this.y = h;
    this.vy = 0;
    this.grounded = true;
    this._prevWx = wx;
    this._prevWz = wz;
    this._prevY = h;

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

    // Reset chairlift state so re-entering doesn't resume a ride
    this.state = 'skiing';
    this.chair = null;
    this.targetLine = null;
    this.targetStation = null;
    this._waitingTime = 0;

    // Reset camera tracking state
    this.cameraHeading = undefined;
    this._smoothCamY = undefined;
    this._smoothTravelX = undefined;
    this._smoothTravelZ = undefined;
    this._lastCamTrackX = undefined;
    this._lastCamTrackZ = undefined;
    
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

  /**
   * @param {number} dt - physics delta time
   * @param {object} chairlifts - chairlift system instance
   */
  update(dt, chairlifts = null) {
    if (!this.active) return false;

    // State Machine
    if (this.state === 'waiting') {
      return this._updateWaiting(dt);
    } else if (this.state === 'riding') {
      return this._updateRiding(dt);
    }

    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    const gravity = 22.0;
    const baseFriction = 0.990;
    const res = this.terrain.resolution;
    const size = this.terrain.size;

    // Grid bounds check
    const { gx, gz } = this.terrain.worldToGrid(this.wx, this.wz);
    if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
      this.active = false;
      return false;
    }

    // Chairlift Detection (only check if grounded and near a potential base)
    if (this.grounded && chairlifts) {
      this._checkChairliftBoarding(chairlifts);
    }

    // Compute terrain gradient
    const sampleR = 3;
    const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
    const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
    const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
    const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));

    const cellSize = size / (res - 1);
    const gradX = (hR - hL) / (2 * sampleR * cellSize);
    const gradZ = (hD - hU) / (2 * sampleR * cellSize);

    // Apply gravity acceleration
    this.vx -= gradX * gravity * dt;
    this.vz -= gradZ * gravity * dt;

    // Steering logic
    const maxTurnAccel = 16.0; // Strong edge bite for carving across the slope
    const turnDamping = 0.97; // Balanced damping — responsive but not twitchy
    
    this._steerInput = 0;
    if (this._keys.left) { this.angularVelocity += maxTurnAccel * dt; this._steerInput = 1; }
    if (this._keys.right) { this.angularVelocity -= maxTurnAccel * dt; this._steerInput = -1; }
    
    this.angularVelocity *= turnDamping;
    this.heading += this.angularVelocity * dt;

    // Downhill alignment: gently rotate heading toward the fall line when not steering.
    // This prevents the skier from getting stuck sliding sideways on slopes.
    if (!this._keys.left && !this._keys.right) {
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);
      if (gradMag > 0.01) {
        // Fall line = steepest downhill direction
        const fallHeading = Math.atan2(-gradX, -gradZ);
        let fallDiff = fallHeading - this.heading;
        while (fallDiff < -Math.PI) fallDiff += Math.PI * 2;
        while (fallDiff > Math.PI) fallDiff -= Math.PI * 2;
        // Stronger pull on steeper slopes, gentle on flats
        const alignStrength = Math.min(gradMag * 3.0, 1.5);
        this.heading += fallDiff * alignStrength * dt;
      }
    }

    // Standard push force (W key)
    if (this._keys.forward && this.grounded) {
      const pushStrength = 1.5;
      this.vx += Math.sin(this.heading) * pushStrength * dt;
      this.vz += Math.cos(this.heading) * pushStrength * dt;
    }

    // Steering force: push velocity towards the heading direction
    this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (this.speed > 0.1) {
      const desiredX = Math.sin(this.heading) * this.speed;
      const desiredZ = Math.cos(this.heading) * this.speed;
      const steerStrength = Math.max(0.8, 4.0 - (this.speed * 0.05)); // Strong edge grip for cross-slope carving
      
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

    // Terrain height at new position
    const terrainH = this.terrain.getInterpolatedHeight(this.wx, this.wz);

    if (this.grounded) {
      const dh = terrainH - this.y;
      const slopeVy = dh / dt;

      // If the ground falls away faster than gravity or we hit a bump fast
      if (slopeVy < -15 && this.speed > 10) {
        this.grounded = false;
        this.vy = slopeVy; 
      } else {
        this.y = terrainH;
        this.vy = slopeVy;
      }
    } else {
      // Air physics
      this.vy -= gravity * dt;
      this.y += this.vy * dt;

      // Landing check
      if (this.y <= terrainH) {
        this.y = terrainH;
        this.vy = 0;
        this.grounded = true;
      }
    }

    return true;
  }

  _checkChairliftBoarding(chairlifts) {
    for (const line of chairlifts.lines) {
      // Check both ends - but only board if it's the LOWER station (the base)
      const isP1Lower = line.p1.y < line.p2.y;
      const baseStation = isP1Lower ? line.p1 : line.p2;
      
      const dx = baseStation.x - this.wx;
      const dz = baseStation.z - this.wz;
      const distSq = dx * dx + dz * dz;

      if (distSq < 4.0 * 4.0) {
        this.state = 'waiting';
        this.targetStation = baseStation;
        this.targetLine = line;
        this.vx = 0;
        this.vz = 0;
        this.speed = 0;
        this._waitingTime = 0;
        break;
      }
    }
  }

  _updateWaiting(dt) {
    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    // Snap to station center
    this.wx = THREE.MathUtils.lerp(this.wx, this.targetStation.x, 0.1);
    this.wz = THREE.MathUtils.lerp(this.wz, this.targetStation.z, 0.1);
    this.y = this.terrain.getInterpolatedHeight(this.wx, this.wz);

    this._waitingTime += dt;

    // Look for a chair arriving at the base
    const isP1Base = this.targetStation === this.targetLine.p1;
    const targetProgress = isP1Base ? 0.0 : 0.5;

    for (const chair of this.targetLine.chairs) {
      const diff = Math.abs(chair.progress - targetProgress);
      // If chair is close to boarding point and moving towards us
      if (diff < 0.02) {
        this.state = 'riding';
        this.chair = chair;
        break;
      }
    }
    return true;
  }

  _updateRiding(dt) {
    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    // Follow the chair mesh
    const chairPos = this.chair.mesh.position;
    this.wx = chairPos.x;
    this.wz = chairPos.z;
    this.y = chairPos.y - 0.7; // Sit slightly below the chair bar

    // Check for dismount
    const isP1Base = this.targetStation === this.targetLine.p1;
    const exitProgress = isP1Base ? 0.5 : 0.0;
    
    // We check if progress is close to exit point
    const diff = Math.abs(this.chair.progress - exitProgress);
    if (diff < 0.01 || (exitProgress === 0.0 && this.chair.progress > 0.99)) {
       this.state = 'skiing';
       this.chair = null;
       this.targetLine = null;
       this.targetStation = null;
       this.vy = 0;
       this.grounded = true;
       // Give a little push forward
       const angle = Math.atan2(this.wz - this._prevWz, this.wx - this._prevWx);
       this.vx = Math.cos(angle) * 5;
       this.vz = Math.sin(angle) * 5;
    }
    return true;
  }

  /** Interpolate visual position between prev and current physics state for sub-frame accuracy */
  interpolateVisuals(alpha, dt) {
    if (!this.active || !this.mesh) return;

    // Position Lerp
    const x = this._prevWx + (this.wx - this._prevWx) * alpha;
    const z = this._prevWz + (this.wz - this._prevWz) * alpha;
    const y = this._prevY + (this.y - this._prevY) * alpha;
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
    // Visual rotation: Tilt skier based on steering + airtime
    const lean = -this._steerInput * 0.4;
    const targetPitch = (this.cameraPitch || 0) * 0.5 - (this.vy * 0.02);
    this.mesh.rotation.z = lean;
    this.mesh.rotation.x = targetPitch;

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
    const h = this._prevY + (this.y - this._prevY) * alpha;
    
    const camDist = 14;  // Slightly tighter follow camera
    const camHeight = 7 + this.cameraPitch * 5; // Balanced height

    // Camera tracks smoothed POSITION movement, not velocity or heading.
    // This makes it immune to sudden changes from pushing/turning keys.
    if (this.cameraHeading === undefined) this.cameraHeading = this.heading;
    if (this._smoothTravelX === undefined) { this._smoothTravelX = 0; this._smoothTravelZ = 0; }

    // Accumulate actual position movement into a heavily smoothed travel direction
    const dx = x - (this._lastCamTrackX || x);
    const dz = z - (this._lastCamTrackZ || z);
    this._lastCamTrackX = x;
    this._lastCamTrackZ = z;

    // Smoothed movement tracking — responsive enough to feel alive, smooth enough to not jitter
    const moveSmoothFactor = 0.06;
    this._smoothTravelX += (dx - this._smoothTravelX) * moveSmoothFactor;
    this._smoothTravelZ += (dz - this._smoothTravelZ) * moveSmoothFactor;

    // Update camera heading based on smoothed travel direction
    const travelMag = Math.sqrt(this._smoothTravelX * this._smoothTravelX + this._smoothTravelZ * this._smoothTravelZ);
    if (travelMag > 0.0005) {
      const travelHeading = Math.atan2(this._smoothTravelX, this._smoothTravelZ);
      let diff = travelHeading - this.cameraHeading;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.cameraHeading += diff * 0.035; // Smooth tracking — stable on turns, follows forward
    }

    const camX = x - Math.sin(this.cameraHeading) * camDist;
    const camZ = z - Math.cos(this.cameraHeading) * camDist;
    let camY = h + camHeight;

    const terrainHAtCam = this.terrain.getInterpolatedHeight(camX, camZ);
    const minHeightAboveGround = 3.0;
    if (camY < terrainHAtCam + minHeightAboveGround) {
      camY = terrainHAtCam + minHeightAboveGround;
    }

    // Smooth vertical camera position to prevent Y-axis jumpiness
    if (this._smoothCamY === undefined) this._smoothCamY = camY;
    this._smoothCamY += (camY - this._smoothCamY) * 0.03;

    const lookY = h + 1.5 + this.cameraPitch * 8;

    this._camPosVec.set(camX, this._smoothCamY, camZ);
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
