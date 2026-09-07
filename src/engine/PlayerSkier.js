import * as THREE from 'three/webgpu';
import { Water } from './Water.js';

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
    this._keys = { left: false, right: false, lookUp: false, lookDown: false, forward: false, brake: false, jump: false, paraglide: false, grab: false };
    this.paragliding = false;

    // Aerial Trick System State
    this.airSpinYaw = 0;
    this.airSpinPitch = 0;
    this.airGrabName = null;
    this.airGrabTime = 0;
    this.airTime = 0;
    this.onTrick = null;

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
    this._chairLookYaw = 0;   // Free-look yaw offset while on chairlift
    this._chairLookPitch = 0; // Free-look pitch while on chairlift

    // Pre-allocated vectors (avoid GC micro-pauses from per-frame allocations)
    this._camPosVec = new THREE.Vector3();
    this._lookAtVec = new THREE.Vector3();

    // Dual Ski Carving Trails (clean crisp powder blue shadow grooves)
    this._trailMat = new THREE.LineBasicMaterial({ color: 0x6897c4, transparent: true, opacity: 0.88 });
    this._leftTrail = null;
    this._rightTrail = null;
    this._leftTrailPoints = [];
    this._rightTrailPoints = [];
    this._trailsVisible = true;

    // Shared materials
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0xff69b4, roughness: 0.6 }); // Pink jacket
    this._pantsMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 });
    this._skinMat = new THREE.MeshStandardMaterial({ color: 0xf4d4b0, roughness: 0.8 });
    this._skiMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.2 }); // Yellow skis

    // Water splash particles
    this.seaLevel = -1;
    this._splashParticles = [];
    this._splashMat = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      metalness: 0.3,
    });
    this._splashGeo = new THREE.SphereGeometry(0.06, 4, 4);
    this._splashPool = [];
    this._splashPoolSize = 80;
    this._splashTimer = 0;
    
    // Snow powder particles (low translucent powder haze)
    this._snowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
      roughness: 1.0,
      metalness: 0.0,
    });
    this._snowPool = [];
    this._snowPoolSize = 200;
    this._snowTimer = 0;

    this._onWater = false;
    this.water = null; // Reference to Water instance for wave surfing

    // Climbing state
    this.isClimbing = false;
    this.climbPhase = 0;
    this._climbWeight = 0.0;
    this._lastClimbStep = 0;

    this._torso = null;
    this._head = null;
    this._helmet = null;
    this._leftLeg = null;
    this._rightLeg = null;
    this._leftSki = null;
    this._rightSki = null;
    this._leftPole = null;
    this._rightPole = null;

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

    // Build Parachute attached directly to skier group container (stays aloft during tricks)
    this._parachute = this._buildParachute();
    this._parachute.position.set(wx, h + 0.15, wz);
    this.group.add(this._parachute);

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

    // Dual Trails
    const maxTrailVerts = 4000;
    const leftGeo = new THREE.BufferGeometry();
    const leftPositions = new Float32Array(maxTrailVerts * 3);
    leftGeo.setAttribute('position', new THREE.BufferAttribute(leftPositions, 3));
    leftGeo.setDrawRange(0, 0);
    this._leftTrail = new THREE.Line(leftGeo, this._trailMat);
    this.group.add(this._leftTrail);

    const rightGeo = new THREE.BufferGeometry();
    const rightPositions = new Float32Array(maxTrailVerts * 3);
    rightGeo.setAttribute('position', new THREE.BufferAttribute(rightPositions, 3));
    rightGeo.setDrawRange(0, 0);
    this._rightTrail = new THREE.Line(rightGeo, this._trailMat);
    this.group.add(this._rightTrail);

    this._leftTrailPoints = [];
    this._rightTrailPoints = [];

    // Start listening for input
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** Remove the player skier and clean up */
  despawn() {
    this.active = false;
    this._keys = { left: false, right: false, lookUp: false, lookDown: false, forward: false, brake: false, jump: false, paraglide: false, grab: false };
    this.paragliding = false;
    this.cameraPitch = 0;
    this.airSpinYaw = 0;
    this.airSpinPitch = 0;
    this.airGrabName = null;
    this.airGrabTime = 0;
    this.airTime = 0;

    // Reset chairlift state so re-entering doesn't resume a ride
    this.state = 'skiing';
    this.chair = null;
    this.targetLine = null;
    this.targetStation = null;
    this._waitingTime = 0;

    // Reset climbing state
    this.isClimbing = false;
    this.climbPhase = 0;
    this._climbWeight = 0.0;
    this._lastClimbStep = 0;

    this._torso = null;
    this._head = null;
    this._helmet = null;
    this._leftLeg = null;
    this._rightLeg = null;
    this._leftSki = null;
    this._rightSki = null;
    this._leftPole = null;
    this._rightPole = null;

    // Reset camera tracking state
    this.cameraHeading = undefined;
    this._smoothCamY = undefined;
    this._smoothLookY = undefined;
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
    if (this._parachute) {
      this.group.remove(this._parachute);
      this._parachute.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      this._parachute = null;
    }
    if (this._leftTrail) {
      this.group.remove(this._leftTrail);
      this._leftTrail.geometry.dispose();
      this._leftTrail = null;
    }
    if (this._rightTrail) {
      this.group.remove(this._rightTrail);
      this._rightTrail.geometry.dispose();
      this._rightTrail = null;
    }
    this._leftTrailPoints = [];
    this._rightTrailPoints = [];

    // Clean up splash particles
    for (const p of this._splashPool) {
      this.group.remove(p.mesh);
    }
    this._splashPool = [];
    this._splashParticles = [];
    
    // Clean up snow particles
    for (const p of this._snowPool) {
      this.group.remove(p.mesh);
    }
    this._snowPool = [];
    
    this._onWater = false;
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
    let gradX = (hR - hL) / (2 * sampleR * cellSize);
    let gradZ = (hD - hU) / (2 * sampleR * cellSize);

    // Check if we're over water BEFORE applying gravity/steering
    const rawTerrainH = this.terrain.getInterpolatedHeight(this.wx, this.wz);
    const overWater = rawTerrainH <= this.seaLevel;

    // Check if we are actually on snow using dynamic snow cover
    const isOnSnow = this.terrain.getSnowCover(this.wx, this.wz) > 0.05;

    // On water the surface is flat — zero out terrain gradient so the skier
    // doesn't get pushed around by the terrain shape underneath the water
    if (overWater && this.grounded) {
      gradX = 0;
      gradZ = 0;
    }

    const slopeDot = Math.sin(this.heading) * gradX + Math.cos(this.heading) * gradZ;
    const forwardSpeed = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);

    // Transition to climbing mode:
    // If player is grounded, pressing forward, facing uphill on a slope, and has very low speed uphill (or is sliding back)
    if (this.grounded && this._keys.forward && slopeDot > 0.03 && forwardSpeed < 1.5) {
      this.isClimbing = true;
    }
    // Transition out of climbing mode:
    if (this.isClimbing) {
      if (!this._keys.forward || slopeDot <= 0.01 || !this.grounded) {
        this.isClimbing = false;
      }
    }

    if (this.isClimbing) {
      // Climbing Physics: Move slowly in heading direction
      const climbSpeed = isOnSnow ? 2.6 : 2.0;
      this.vx = Math.sin(this.heading) * climbSpeed;
      this.vz = Math.cos(this.heading) * climbSpeed;

      // Gentle steering while climbing
      const maxTurnAccel = 12.0;
      const turnDamping = 0.94;
      const maxAngularVel = 2.0;

      this._steerInput = 0;
      if (this._keys.left) { this.angularVelocity += maxTurnAccel * dt; this._steerInput = 1; }
      if (this._keys.right) { this.angularVelocity -= maxTurnAccel * dt; this._steerInput = -1; }

      this.angularVelocity *= turnDamping;
      this.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, this.angularVelocity));
      this.heading += this.angularVelocity * dt;

      this.speed = climbSpeed;
      this.climbPhase = (this.climbPhase || 0) + dt * 10.0;

      // Trigger custom snow powder particles exactly when the skier's feet plant on each step
      const stepInterval = Math.PI;
      const currentStep = Math.floor(this.climbPhase / stepInterval);
      if (currentStep !== this._lastClimbStep) {
        this._lastClimbStep = currentStep;
        const footSide = (currentStep % 2 === 0) ? 1 : -1;
        const sinH = Math.sin(this.heading);
        const cosH = Math.cos(this.heading);
        // foot world position
        const fx = this.wx + cosH * (footSide * 0.1) - sinH * 0.1;
        const fz = this.wz - sinH * (footSide * 0.1) - cosH * 0.1;

        // Emit snow puff
        for (let i = 0; i < 2; i++) {
          this._emitSnow(fx, this.y, fz);
        }
      }
    } else {
      // High-performance Downhill GS Carving Physics
      this.vx -= gradX * gravity * dt;
      this.vz -= gradZ * gravity * dt;

      this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

      // Dynamic steering control: turn rate scales smoothly for sweeping GS arcs
      const turnAccel = 22.0; // High edge bite
      const turnDamping = 0.92;
      
      // Speed-dependent max angular velocity for authentic sweeping GS turns
      const baseMaxTurn = 2.8;
      const maxAngularVel = Math.max(1.6, baseMaxTurn - Math.min(this.speed * 0.04, 1.2));

      this._steerInput = 0;
      if (this._keys.left) { this.angularVelocity += turnAccel * dt; this._steerInput = 1; }
      if (this._keys.right) { this.angularVelocity -= turnAccel * dt; this._steerInput = -1; }
      
      this.angularVelocity *= turnDamping;
      this.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, this.angularVelocity));

      // Track edge turn transitions for "carve pop" rebound acceleration
      const prevSteerDir = Math.sign(this._lastAngularVel || 0);
      const currSteerDir = Math.sign(this.angularVelocity);
      if (prevSteerDir !== 0 && currSteerDir !== 0 && prevSteerDir !== currSteerDir && this.grounded && isOnSnow) {
        // Edge switch rebound acceleration
        const popBoost = Math.min(this.speed * 0.12, 3.0);
        this.vx += Math.sin(this.heading) * popBoost;
        this.vz += Math.cos(this.heading) * popBoost;
      }
      this._lastAngularVel = this.angularVelocity;

      this.heading += this.angularVelocity * dt;

      // Downhill alignment: gently rotate heading toward the fall line when not steering.
      if (!this._keys.left && !this._keys.right && !overWater && !this.paragliding) {
        const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);
        if (gradMag > 0.01) {
          const fallHeading = Math.atan2(-gradX, -gradZ);
          let fallDiff = fallHeading - this.heading;
          while (fallDiff < -Math.PI) fallDiff += Math.PI * 2;
          while (fallDiff > Math.PI) fallDiff -= Math.PI * 2;
          const alignStrength = Math.min(gradMag * 2.5, 1.2);
          this.heading += fallDiff * alignStrength * dt;
        }
      }

      // Edge Carving Grip: convert lateral slip into crisp carving velocity along the ski edge angle
      if (this.speed > 0.1 && this.grounded && !overWater) {
        const sinH = Math.sin(this.heading);
        const cosH = Math.cos(this.heading);

        // Forward and lateral components of velocity relative to ski heading
        const vFwd = this.vx * sinH + this.vz * cosH;
        const vLat = this.vx * cosH - this.vz * sinH; // perpendicular to heading

        // Edge grip factor: on snow, ski edge cuts deep into slope
        const edgeGripRate = isOnSnow ? 14.0 : 8.0; 
        
        // Dampen lateral drift (sideslip) while transferring a portion of lateral kinetic energy into forward carve
        const newVLat = vLat * Math.max(0, 1.0 - edgeGripRate * dt);
        const latEnergyTransferred = (Math.abs(vLat) - Math.abs(newVLat)) * 0.45;
        const newVFwd = vFwd + Math.sign(vFwd || 1) * latEnergyTransferred;

        // Reconstruct velocity from carved forward and damped lateral vectors
        this.vx = newVFwd * sinH + newVLat * cosH;
        this.vz = newVFwd * cosH - newVLat * sinH;
      }

      // Forward push & GS Tuck (W or ArrowUp)
      if (this._keys.forward) {
        const pushForce = (this.grounded && !isOnSnow) ? 10.0 : 15.0;
        this.vx += Math.sin(this.heading) * pushForce * dt;
        this.vz += Math.cos(this.heading) * pushForce * dt;
      }
    }

    // Camera pitch (W/S keys)
    const pitchSpeed = 1.5; // radians/sec
    if (this._keys.lookUp) this.cameraPitch = Math.min(this.cameraPitch + pitchSpeed * dt, 1.0);
    if (this._keys.lookDown) this.cameraPitch = Math.max(this.cameraPitch - pitchSpeed * dt, -0.5);
    // Gently return to neutral when not pressing
    if (!this._keys.lookUp && !this._keys.lookDown) {
      this.cameraPitch *= 0.92;
    }

    // Aerodynamic Drag & Speed Cap:
    // 1 internal speed unit = 5 mph
    // In full GS tuck stance (pressing W / Forward), top speed is capped at ~95-100 mph (19.0-20.0 internal speed).
    // In normal upright stance, top speed tops out at ~75-80 mph (15.0-16.0 internal speed).
    const isTucking = this._keys.lookUp || (this._keys.forward && this.grounded);
    const maxTopSpeed = isTucking ? 20.0 : 16.0;

    let friction = baseFriction;
    if (this._keys.brake) {
      friction = 0.86; // Strong edge check / hockey stop brake
    } else {
      // Progressive aerodynamic drag scaling as speed approaches top limit
      if (this.speed > 8.0) {
        const speedRatio = Math.min(1.4, this.speed / maxTopSpeed);
        const dragFactor = 1.0 - (speedRatio * speedRatio * 0.035);
        friction *= Math.max(0.94, dragFactor);
      }
    }

    if (this.grounded && !overWater && !isOnSnow) {
      friction *= 0.985; // Slightly higher friction on grass/dirt/rock
    }

    this.vx *= friction;
    this.vz *= friction;
    this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

    // Hard top speed clamp (100 mph absolute ceiling in GS tuck)
    if (this.speed > maxTopSpeed) {
      const clampRatio = maxTopSpeed / this.speed;
      this.vx *= clampRatio;
      this.vz *= clampRatio;
      this.speed = maxTopSpeed;
    }

    // Move
    this.wx += this.vx * dt;
    this.wz += this.vz * dt;

    // Terrain height at new position (re-sample after movement)
    const rawTerrainH2 = this.terrain.getInterpolatedHeight(this.wx, this.wz);
    
    // Wave height at skier position (if water system is available)
    const waveOffset = this.water ? this.water.getWaveHeight(this.wx, this.wz) : 0;
    const waveH = this.seaLevel + waveOffset;
    
    // Deep snow powder sinking calculation
    if (this.grounded && !overWater && isOnSnow) {
      const snowCover = this.terrain.getSnowCover(this.wx, this.wz);
      const maxSink = 0.14; // Skis sink up to 0.14 units into deep powder
      const sinkTarget = maxSink * Math.min(1.0, Math.max(0, (snowCover - 0.05) / 0.8));
      this._currentSink = (this._currentSink || 0) * 0.9 + sinkTarget * 0.1;
    } else {
      this._currentSink = (this._currentSink || 0) * 0.85;
    }

    const terrainH = Math.max(rawTerrainH2, overWater ? waveH : -Infinity);
    const effectiveGroundY = terrainH - (this._currentSink || 0);

    // Water detection: terrain at or below sea level means we're on water
    this._onWater = this.grounded && rawTerrainH2 <= this.seaLevel;

    // Water Planing & Slow Sinking Mechanics:
    // Lowers sink threshold to 8 mph (speed * 5.0 = mph, so 8 mph = 1.6 internal speed)
    const sinkThreshold = 8.0 / 5.0;

    if (this._onWater && this.grounded) {
      if (this.speed < sinkThreshold) {
        // Slow speed on water — start or continue slow sinking!
        this._sinking = true;
        this._sinkTimer = (this._sinkTimer || 0) + dt;

        // Gently decelerate
        this.vx *= 0.96;
        this.vz *= 0.96;
        this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

        // Sink below water surface over 2.5 seconds
        const sinkT = Math.min(1.0, this._sinkTimer / 2.5); // 0→1 over 2.5s
        this.y = waveH - (sinkT * sinkT * 1.5);

        // Despawn if submerged after 2.5 seconds
        if (this._sinkTimer > 2.5) {
          this.active = false;
          return false;
        }

        // Emit splash bubbles while sinking
        this._splashTimer += dt;
        if (this._splashTimer >= 0.08) {
          this._splashTimer -= 0.08;
          this._emitSplash(this.wx, waveH, this.wz);
        }
      } else {
        // Planing on water with full control!
        this._sinking = false;
        this._sinkTimer = 0;

        // Light water drag
        const waterDrag = 0.997;
        this.vx *= waterDrag;
        this.vz *= waterDrag;
        this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

        // Emit water splash particles behind skis
        this._splashTimer += dt;
        const emitInterval = Math.max(0.01, 0.06 - this.speed * 0.003);
        while (this._splashTimer >= emitInterval) {
          this._splashTimer -= emitInterval;
          const count = this.speed > 5 ? 3 : (this.speed > 2 ? 2 : 1);
          for (let i = 0; i < count; i++) {
            this._emitSplash(this.wx, waveH, this.wz);
          }
        }
      }
    } else {
      this._splashTimer = 0;
      this._sinking = false;
      this._sinkTimer = 0;
    }

    if (this.grounded && this.speed > 1.0 && isOnSnow) {
      // Emit continuous translucent powder spray behind ski tails on snow
      this._snowTimer += dt;
      const emitInterval = 0.02; 
      while (this._snowTimer >= emitInterval) {
        this._snowTimer -= emitInterval;
        const count = (Math.abs(this.angularVelocity) > 0.3 || this.speed > 5.0) ? 3 : 2;
        for (let i = 0; i < count; i++) {
          this._emitSnow(this.wx, terrainH, this.wz);
        }
      }
    } else {
      this._snowTimer = 0;
    }

    if (this.grounded) {
      this.paragliding = false; // Reset paragliding on the ground
      // Manual Jump
      if (this._keys.jump) {
        this.grounded = false;
        // Launch with upward velocity for an intentional jump
        const slopeVy = Math.max((effectiveGroundY - this.y) / dt, 0);
        this.vy = slopeVy + 6.0; 
        this._keys.jump = false; // Consume the jump press
      } else {
        // Calculate where physics would put us if we went airborne this frame
        const ballisticVy = this.vy - gravity * dt;
        const ballisticY = this.y + ballisticVy * dt;

        // Skier only catches air over significant terrain drop-offs/cliffs or steep crests (prevents micro-bouncing)
        const terrainDrop = ballisticY - effectiveGroundY;
        if (terrainDrop > 0.65 && this.speed > 6.0) {
          this.grounded = false;
          this.vy = ballisticVy;
          this.y = ballisticY;
        } else {
          // Stick to the ground smoothly — snow suspension dampens sharp upward slope acceleration
          const targetVy = (effectiveGroundY - this.y) / dt;
          this.vy = THREE.MathUtils.lerp(this.vy, Math.min(targetVy, 6.0), 0.35);
          this.y = effectiveGroundY;
        }
      }
    } else {
      // Air physics
      if (this.state === 'riding' || this.state === 'waiting') {
        this.paragliding = false;
      }

      if (this.paragliding) {
        // Paraglider Physics — low sink rate for long distance map traversal
        const chuteGravity = 0.30;
        this.vy -= chuteGravity * dt;
        
        // Terminal descent speed check
        if (this.vy < -2.0) {
          this.vy += (this.vy * -1.2) * dt; 
        }

        // Steer while flying (responsive turning)
        const airTurnSpeed = 3.5;
        if (this._keys.left) { this.heading += airTurnSpeed * dt; this._steerInput = 1; }
        if (this._keys.right) { this.heading -= airTurnSpeed * dt; this._steerInput = -1; }
        
        // Base forward glide cruise (always glides forward while parachute is open!)
        const baseCruiseThrust = 25.0;
        this.vx += Math.sin(this.heading) * baseCruiseThrust * dt;
        this.vz += Math.cos(this.heading) * baseCruiseThrust * dt;

        // Boosted Forward Flight & Thermal Lift (holding W or Forward key)
        if (this._keys.forward || this._keys.lookUp) {
          const flyThrust = 45.0;
          this.vx += Math.sin(this.heading) * flyThrust * dt;
          this.vz += Math.cos(this.heading) * flyThrust * dt;
          // Thermal lift to maintain or gain altitude while flying forward
          this.vy += 2.8 * dt;
        }

        // Ridge Lift: gain elevation when flying towards rising terrain
        const uphillFlow = -(this.vx * gradX + this.vz * gradZ);
        if (uphillFlow > 0) {
          const heightAboveGround = this.y - terrainH;
          const maxLiftHeight = 25.0;
          if (heightAboveGround < maxLiftHeight) {
            const liftEffect = (1.0 - heightAboveGround / maxLiftHeight);
            const rawTargetLift = uphillFlow * 1.2 * liftEffect;
            this._smoothLift = (this._smoothLift || 0) * 0.9 + rawTargetLift * 0.1;
            this.vy += this._smoothLift * dt;
          }
        } else {
          this._smoothLift = 0;
        }

        // Glide friction
        const airFriction = 0.985;
        this.vx *= airFriction;
        this.vz *= airFriction;

        // Align velocity to heading so you fly smoothly where you look
        const curSpeed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
        if (curSpeed > 0.1) {
          const desiredX = Math.sin(this.heading) * curSpeed;
          const desiredZ = Math.cos(this.heading) * curSpeed;
          this.vx += (desiredX - this.vx) * 4.0 * dt;
          this.vz += (desiredZ - this.vz) * 4.0 * dt;
        }

        // Aerial Tricks while Paragliding (Freestyle Speedriding / Acro Flight)
        this.airTime = (this.airTime || 0) + dt;

        const spinSpeed = 7.5;
        const flipSpeed = 6.2;

        if (this._keys.grab) {
          if (this._keys.left)  this.airSpinYaw = (this.airSpinYaw || 0) + spinSpeed * dt;
          if (this._keys.right) this.airSpinYaw = (this.airSpinYaw || 0) - spinSpeed * dt;
          if (this._keys.forward || this._keys.lookUp) this.airSpinPitch = (this.airSpinPitch || 0) + flipSpeed * dt;
          if (this._keys.brake || this._keys.lookDown) this.airSpinPitch = (this.airSpinPitch || 0) - flipSpeed * dt;

          if (this._keys.left) {
            this.airGrabName = 'MUTE';
          } else if (this._keys.right) {
            this.airGrabName = 'SAFETY';
          } else if (this._keys.forward || this._keys.lookUp) {
            this.airGrabName = 'TAIL';
          } else if (this._keys.brake || this._keys.lookDown) {
            this.airGrabName = 'JAPAN';
          } else {
            this.airGrabName = 'METHOD';
          }
          this.airGrabTime = (this.airGrabTime || 0) + dt;
        } else {
          // Smoothly realign skier under canopy when not holding grab
          if (this.airSpinYaw) {
            this.airSpinYaw *= Math.pow(0.01, dt);
            if (Math.abs(this.airSpinYaw) < 0.01) this.airSpinYaw = 0;
          }
          if (this.airSpinPitch) {
            this.airSpinPitch *= Math.pow(0.01, dt);
            if (Math.abs(this.airSpinPitch) < 0.01) this.airSpinPitch = 0;
          }
          this.airGrabName = null;
          this.airGrabTime = 0;
        }
      } else {
        // Normal falling physics & Aerial Tricks
        this.vy -= gravity * dt;

        this.airTime = (this.airTime || 0) + dt;

        // Spins (Yaw: 360 / 720 / 1080)
        const spinSpeed = 7.5; // rad/sec (~430 deg/sec)
        if (this._keys.left)  this.airSpinYaw = (this.airSpinYaw || 0) + spinSpeed * dt;
        if (this._keys.right) this.airSpinYaw = (this.airSpinYaw || 0) - spinSpeed * dt;

        // Flips (Pitch: Backflip / Frontflip)
        const flipSpeed = 6.2; // rad/sec (~355 deg/sec)
        if (this._keys.forward || this._keys.lookUp)   this.airSpinPitch = (this.airSpinPitch || 0) + flipSpeed * dt;
        if (this._keys.brake || this._keys.lookDown)   this.airSpinPitch = (this.airSpinPitch || 0) - flipSpeed * dt;

        // Air Grabs
        if (this._keys.grab) {
          if (this._keys.left) {
            this.airGrabName = 'MUTE';
          } else if (this._keys.right) {
            this.airGrabName = 'SAFETY';
          } else if (this._keys.forward || this._keys.lookUp) {
            this.airGrabName = 'TAIL';
          } else if (this._keys.brake || this._keys.lookDown) {
            this.airGrabName = 'JAPAN';
          } else {
            this.airGrabName = 'METHOD';
          }
          this.airGrabTime = (this.airGrabTime || 0) + dt;
        } else {
          this.airGrabName = null;
          this.airGrabTime = 0;
        }
      }

      this.y += this.vy * dt;

      // Landing check with snow force absorption & knee compression
      if (this.y <= terrainH) {
        const impactSpeed = -this.vy; // downward vertical impact velocity
        this.y = terrainH;
        this.vy = 0;

        this.grounded = true;
        this.paragliding = false;

        // Reset air trick state
        this.airSpinYaw = 0;
        this.airSpinPitch = 0;
        this.airGrabName = null;
        this.airGrabTime = 0;
        this.airTime = 0;

        if (impactSpeed > 0.5) {
          // Snow and knees absorb vertical landing force
          this._kneeCompression = Math.min(0.28, (impactSpeed * 0.015) + (this._kneeCompression || 0));
          
          if (isOnSnow) {
            // Soft powder spray burst proportional to impact force
            const sprayCount = Math.min(12, Math.floor(impactSpeed * 0.5));
            for (let i = 0; i < sprayCount; i++) {
              this._emitSnow(this.wx, terrainH, this.wz);
            }
            // Snow absorbs kinetic shock on heavy landings
            if (impactSpeed > 5.0) {
              const absorbRatio = Math.max(0.82, 1.0 - (impactSpeed - 5.0) * 0.012);
              this.vx *= absorbRatio;
              this.vz *= absorbRatio;
              this.speed *= absorbRatio;
            }
          }
        }
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
      const boardRadius = line.type === 'tram' ? 6.5 : 4.0;

      if (distSq < boardRadius * boardRadius) {
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
    this.paragliding = false;
    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    // Snap to station center
    this.wx = THREE.MathUtils.lerp(this.wx, this.targetStation.x, 0.1);
    this.wz = THREE.MathUtils.lerp(this.wz, this.targetStation.z, 0.1);
    this.y = this.terrain.getInterpolatedHeight(this.wx, this.wz);

    this._waitingTime += dt;

    // Look for a chair/cabin departing UPWARDS from the base station
    const isP1Base = this.targetStation === this.targetLine.p1;
    const window = this.targetLine.type === 'tram' ? 0.08 : 0.06;

    for (const chair of this.targetLine.chairs) {
      if (isP1Base) {
        // Base is p1: upward direction is progress 0.0 -> 0.5
        // Board only when vehicle has turned around at p1 and is departing UPWARDS
        if ((chair.progress >= 0.0 && chair.progress <= window) || chair.progress >= 0.98) {
          this.state = 'riding';
          this.chair = chair;
          break;
        }
      } else {
        // Base is p2: upward direction is progress 0.5 -> 1.0
        // Board only when vehicle has turned around at p2 and is departing UPWARDS
        if (chair.progress >= 0.50 && chair.progress <= (0.50 + window)) {
          this.state = 'riding';
          this.chair = chair;
          break;
        }
      }
    }
    return true;
  }

  _updateRiding(dt) {
    this.paragliding = false;
    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    // Follow the chair/tram cabin mesh
    if (!this.chair || !this.chair.mesh) {
      this.state = 'skiing';
      this.chair = null;
      this._chairLookYaw = 0;
      this._chairLookPitch = 0;
      return true;
    }

    const chairPos = this.chair.mesh.position;
    if (!isFinite(chairPos.x) || !isFinite(chairPos.y) || !isFinite(chairPos.z)) {
      this.state = 'skiing';
      this.chair = null;
      this._chairLookYaw = 0;
      this._chairLookPitch = 0;
      return true;
    }

    this.wx = chairPos.x;
    this.wz = chairPos.z;
    const rideOffset = (this.targetLine && this.targetLine.type === 'tram') ? 1.8 : 0.7;
    this.y = chairPos.y - rideOffset; // Sit/stand naturally inside cabin or on chairlift bench

    // Guard: if position somehow became NaN, bail out of riding
    if (!isFinite(this.wx) || !isFinite(this.wz) || !isFinite(this.y)) {
      this.wx = this._prevWx;
      this.wz = this._prevWz;
      this.y = this._prevY;
      this.state = 'skiing';
      this.chair = null;
      this._chairLookYaw = 0;
      this._chairLookPitch = 0;
      return true;
    }

    // Free-look while riding: left/right arrows rotate camera, W/S pitch
    const lookSpeed = 2.0; // radians/sec
    const pitchSpeed = 2.5;
    if (this._keys.left)  this._chairLookYaw += lookSpeed * dt;
    if (this._keys.right) this._chairLookYaw -= lookSpeed * dt;
    if (this._keys.lookUp)   this._chairLookPitch = Math.min(this._chairLookPitch + pitchSpeed * dt, 8.0);
    if (this._keys.lookDown) this._chairLookPitch = Math.max(this._chairLookPitch - pitchSpeed * dt, -2.0);
    // Gently return pitch to neutral when not pressing (slower return rate for lift look)
    if (!this._keys.lookUp && !this._keys.lookDown) {
      this._chairLookPitch *= Math.pow(0.99, dt * 60);
    }

    // Check for dismount at top station
    const isP1Base = this.targetStation === this.targetLine.p1;
    let reachedTop = false;

    if (isP1Base) {
      // Top station is p2 (progress = 0.5)
      if (this.chair.progress >= 0.46 && this.chair.progress <= 0.53) {
        reachedTop = true;
      }
    } else {
      // Top station is p1 (progress = 1.0 / 0.0)
      if (this.chair.progress >= 0.96 || this.chair.progress <= 0.03) {
        reachedTop = true;
      }
    }

    if (reachedTop) {
       this.state = 'skiing';
       this.chair = null;
       this.targetLine = null;
       this.targetStation = null;
       this._chairLookYaw = 0;
       this._chairLookPitch = 0;
       this.vy = 0;
       this.grounded = true;
       // Give a little push forward
       let dx = this.wx - this._prevWx;
       let dz = this.wz - this._prevWz;
       const angle = (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) ? this.heading : Math.atan2(dz, dx);
       this.vx = Math.cos(angle) * 5;
       this.vz = Math.sin(angle) * 5;
     }
     return true;
   }

   _isNearChairlift(wx, wz, chairlifts, threshold = 30) {
     if (!chairlifts || !chairlifts.lines || chairlifts.lines.length === 0) return false;
     for (const line of chairlifts.lines) {
       const isP1Lower = line.p1.y < line.p2.y;
       const base = isP1Lower ? line.p1 : line.p2;
       const dSq = (wx - base.x) ** 2 + (wz - base.z) ** 2;
       if (dSq <= threshold * threshold) return true;
     }
     return false;
   }

   /** Interpolate visual position between prev and current physics state for sub-frame accuracy */
  interpolateVisuals(alpha, dt) {
    if (!this.active || !this.mesh) return;

    // Position Lerp
    const x = this._prevWx + (this.wx - this._prevWx) * alpha;
    const z = this._prevWz + (this.wz - this._prevWz) * alpha;
    const y = this._prevY + (this.y - this._prevY) * alpha;
    
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;

    // Smoothly decay knee compression force over time
    if (this._kneeCompression > 0) {
      this._kneeCompression *= Math.pow(0.01, dt);
      if (this._kneeCompression < 0.001) this._kneeCompression = 0;
    }

    this.mesh.position.set(x, y + 0.15 - (this._kneeCompression || 0) * 0.5, z);

    // Frame-rate independent exponential tracking (~99.9% convergence per sec)
    const smoothFactor = 1 - Math.pow(0.0001, dt);

    // Mesh Rotation
    const targetRot = this.heading;
    let diff = targetRot - this.mesh.rotation.y;
    if (isFinite(diff)) {
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.mesh.rotation.y += diff * smoothFactor; 
    }
    // Lean into the turn
    const targetLean = -(this.angularVelocity || 0) * 0.15;
    if (this._currentLean === undefined) this._currentLean = 0;
    this._currentLean += (targetLean - this._currentLean) * smoothFactor;
    // Lerp climb weight smoothly
    if (this._climbWeight === undefined) this._climbWeight = 0.0;
    const targetClimbWeight = this.isClimbing ? 1.0 : 0.0;
    this._climbWeight += (targetClimbWeight - this._climbWeight) * smoothFactor;

    // Ski Edge Roll & Body Leaning
    const edgeRollTarget = -this.angularVelocity * 0.25;
    if (this._currentEdgeRoll === undefined) this._currentEdgeRoll = 0;
    this._currentEdgeRoll += (edgeRollTarget - this._currentEdgeRoll) * smoothFactor;
    
    if (this._leftSki && this._rightSki) {
      this._leftSki.rotation.z = this._currentEdgeRoll;
      this._rightSki.rotation.z = this._currentEdgeRoll;
    }

    // GS Tuck Stance & Body Lean
    const isTucking = this._keys.forward && this.grounded && !this.isClimbing;
    const tuckWeightTarget = isTucking ? 1.0 : Math.min(this.speed / 12.0, 0.6);
    if (this._tuckWeight === undefined) this._tuckWeight = 0;
    this._tuckWeight += (tuckWeightTarget - this._tuckWeight) * smoothFactor;

    if (!this.isClimbing && this._torso) {
      const compressionOffset = this._kneeCompression || 0;
      this._torso.position.y = (0.32 - this._tuckWeight * 0.08) - compressionOffset;
      this._torso.rotation.x = this._tuckWeight * 0.35;
      const counterRot = (this.angularVelocity || 0) * 0.08;
      this._torso.rotation.y = counterRot;
      if (this._head) this._head.rotation.y = counterRot;
      if (this._helmet) this._helmet.rotation.y = counterRot;
    }

    // Visual rotation: Tilt skier based on steering + airtime tricks
    const lean = -this._steerInput * 0.4;
    let targetPitch = (this.cameraPitch || 0) * 0.5 - (this.vy * 0.02);
    if (this.isClimbing) {
      targetPitch += 0.4 * this._climbWeight; // Lean forward into the slope
    }

    if (!this.grounded) {
      this.mesh.rotation.y = this.heading + (this.airSpinYaw || 0);
      this.mesh.rotation.x = targetPitch + (this.airSpinPitch || 0);
      this.mesh.rotation.z = lean;

      // Grab Visual Posing
      if (this.airGrabName) {
        if (this._leftSki && this._rightSki) {
          this._leftSki.rotation.y = 0.35;
          this._rightSki.rotation.y = -0.35;
        }
        if (this._leftLeg && this._rightLeg) {
          this._leftLeg.rotation.x = -0.50;
          this._rightLeg.rotation.x = -0.50;
        }
        if (this._leftArm && this._rightArm) {
          this._leftArm.rotation.x = 0.90;
          this._rightArm.rotation.x = 0.90;
        }
        if (this._torso) {
          this._torso.rotation.x = 0.50;
        }
      } else {
        if (this._leftSki && this._rightSki) {
          this._leftSki.rotation.y = 0;
          this._rightSki.rotation.y = 0;
        }
        if (this._leftLeg && this._rightLeg) {
          this._leftLeg.rotation.x = 0;
          this._rightLeg.rotation.x = 0;
        }
        if (this._leftArm && this._rightArm) {
          this._leftArm.rotation.x = 0;
          this._rightArm.rotation.x = 0;
        }
      }
    } else {
      this.mesh.rotation.z = lean;
      this.mesh.rotation.x = targetPitch;
      if (this._leftSki && this._rightSki) {
        this._leftSki.rotation.y = 0;
        this._rightSki.rotation.y = 0;
      }
      if (this._leftLeg && this._rightLeg) {
        this._leftLeg.rotation.x = 0;
        this._rightLeg.rotation.x = 0;
      }
      if (this._leftArm && this._rightArm) {
        this._leftArm.rotation.x = 0;
        this._rightArm.rotation.x = 0;
      }
    }

    // Cross-country/skinning glide stride animation on individual mesh parts
    if (this._leftSki && this._rightSki && this._leftLeg && this._rightLeg && this._leftPole && this._rightPole && this._torso) {
      const phase = this.climbPhase || 0;
      
      const leftVal = Math.sin(phase) * this._climbWeight;
      const rightVal = Math.sin(phase + Math.PI) * this._climbWeight;
      const leftLift = Math.max(0, Math.sin(phase)) * this._climbWeight;
      const rightLift = Math.max(0, Math.sin(phase + Math.PI)) * this._climbWeight;
      
      // Parallel skis for skinning/cross-country (no herringbone splay!)
      const splay = 0.0;

      // Update Skis splay, lift and stride
      this._leftSki.rotation.y = splay;
      this._rightSki.rotation.y = -splay;
      this._leftSki.position.z = leftVal * 0.35; // Nice, long cross-country stride!
      this._rightSki.position.z = rightVal * 0.35;
      
      // Skinning slides along snow: very low vertical lift!
      this._leftSki.position.y = 0.015 + leftLift * 0.02;
      this._rightSki.position.y = 0.015 + rightLift * 0.02;

      // Update Legs stride and lift
      this._leftLeg.position.z = leftVal * 0.35;
      this._rightLeg.position.z = rightVal * 0.35;
      this._leftLeg.position.y = 0.12 + leftLift * 0.02;
      this._rightLeg.position.y = 0.12 + rightLift * 0.02;

      // Update Poles plant in opposition to skis, swing dynamically
      this._leftPole.position.z = rightVal * 0.3;
      this._leftPole.position.y = 0.22 + rightLift * 0.04;
      this._leftPole.rotation.x = -rightVal * 0.45; // Dynamic pole swing
      this._leftPole.rotation.z = -0.2 * (1 - this._climbWeight) - 0.25 * this._climbWeight;

      this._rightPole.position.z = leftVal * 0.3;
      this._rightPole.position.y = 0.22 + leftLift * 0.04;
      this._rightPole.rotation.x = -leftVal * 0.45;
      this._rightPole.rotation.z = 0.2 * (1 - this._climbWeight) + 0.25 * this._climbWeight;

      // Torso & Head Bobbing & Swaying to look alive
      this._torso.position.x = leftVal * 0.01;
      if (this._head) this._head.position.x = leftVal * 0.01;
      if (this._helmet) this._helmet.position.x = leftVal * 0.01;
    }

    // Toggle Parachute visibility and animation
    if (this._parachute) {
      this._parachute.visible = this.paragliding;
      if (this.paragliding) {
        this._parachute.position.set(x, y + 0.15 - (this._kneeCompression || 0) * 0.5, z);
        // Smoothly orient the canopy toward flight heading with aerodynamic sway
        const targetRotZ = -lean * 0.5;
        const targetRotX = -targetPitch * 0.5 - 0.2;
        this._parachute.rotation.y = this.heading;
        this._parachute.rotation.z += (targetRotZ - this._parachute.rotation.z) * smoothFactor;
        this._parachute.rotation.x += (targetRotX - this._parachute.rotation.x) * smoothFactor;
      }
    }

    // Update splash particles
    this._updateSplashParticles(dt);
    this._updateSnowParticles(dt);

    // Dual Ski Carve Trails
    if (!this._trailsVisible) {
      if (this._leftTrail) this._leftTrail.visible = false;
      if (this._rightTrail) this._rightTrail.visible = false;
      return;
    }
    if (this._leftTrail) this._leftTrail.visible = true;
    if (this._rightTrail) this._rightTrail.visible = true;

    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);
    const skiOffset = 0.09;

    // Calculate left and right ski track world coordinates
    const lx = x - cosH * skiOffset;
    const lz = z + sinH * skiOffset;
    const rx = x + cosH * skiOffset;
    const rz = z - sinH * skiOffset;
    const trackY = y + 0.02;

    const ltp = this._leftTrailPoints;
    const rtp = this._rightTrailPoints;
    const maxTrailVerts = 4000;

    const lastLIdx = ltp.length - 3;
    let addPoint = true;
    if (lastLIdx >= 0) {
      const dx = lx - ltp[lastLIdx];
      const dz = lz - ltp[lastLIdx + 2];
      if (dx * dx + dz * dz < 0.09) addPoint = false; // < 0.3 units spacing
    }

    if (addPoint && this.grounded && !this._onWater) {
      ltp.push(lx, trackY, lz);
      rtp.push(rx, trackY, rz);

      if (ltp.length > maxTrailVerts * 3) {
        this._leftTrailPoints = ltp.slice(ltp.length - maxTrailVerts * 3);
        this._rightTrailPoints = rtp.slice(rtp.length - maxTrailVerts * 3);
      }

      if (this._leftTrail && this._rightTrail) {
        const lPosAttr = this._leftTrail.geometry.attributes.position;
        const lCount = Math.min(this._leftTrailPoints.length, maxTrailVerts * 3);
        const lOffset = this._leftTrailPoints.length - lCount;
        lPosAttr.array.set(this._leftTrailPoints.slice(lOffset, lOffset + lCount));
        lPosAttr.needsUpdate = true;
        this._leftTrail.geometry.setDrawRange(0, lCount / 3);

        const rPosAttr = this._rightTrail.geometry.attributes.position;
        const rCount = Math.min(this._rightTrailPoints.length, maxTrailVerts * 3);
        const rOffset = this._rightTrailPoints.length - rCount;
        rPosAttr.array.set(this._rightTrailPoints.slice(rOffset, rOffset + rCount));
        rPosAttr.needsUpdate = true;
        this._rightTrail.geometry.setDrawRange(0, rCount / 3);
      }
    }
  }

  /** Get the chase camera target position and look-at (uses pre-allocated vectors) */
  getCameraTarget(alpha, dt) {
    // Interpolate everything strictly to exactly match visual drawing
    let x = this._prevWx + (this.wx - this._prevWx) * alpha;
    let z = this._prevWz + (this.wz - this._prevWz) * alpha;
    let h = this._prevY + (this.y - this._prevY) * alpha;

    // NaN guard: if interpolation produced garbage, fall back to last known good values
    if (!isFinite(x)) x = this.wx || 0;
    if (!isFinite(z)) z = this.wz || 0;
    if (!isFinite(h)) h = this.y || 0;
    
    // Use dt for frame-rate independent smoothing (fall back to 1/60 if missing)
    const frameDt = dt || (1 / 60);

    // Camera tracks smoothed POSITION movement, not velocity or heading.
    // This makes it immune to sudden changes from pushing/turning keys.
    if (this.cameraHeading === undefined) this.cameraHeading = this.heading;
    if (this._smoothTravelX === undefined) { this._smoothTravelX = 0; this._smoothTravelZ = 0; }

    // Accumulate actual position movement into a heavily smoothed travel direction
    const dx = x - (this._lastCamTrackX || x);
    const dz = z - (this._lastCamTrackZ || z);
    this._lastCamTrackX = x;
    this._lastCamTrackZ = z;

    // Frame-rate independent smoothed movement tracking
    // Time constant ~0.5s — responsive enough to track direction changes, smooth enough to filter jitter
    const moveSmooth = 1 - Math.pow(0.001, frameDt);
    this._smoothTravelX += (dx - this._smoothTravelX) * moveSmooth;
    this._smoothTravelZ += (dz - this._smoothTravelZ) * moveSmooth;

    // NaN guard on smooth accumulators
    if (!isFinite(this._smoothTravelX)) this._smoothTravelX = 0;
    if (!isFinite(this._smoothTravelZ)) this._smoothTravelZ = 0;

    // Update camera heading based on smoothed travel direction or skier heading
    const travelMag = Math.sqrt(this._smoothTravelX * this._smoothTravelX + this._smoothTravelZ * this._smoothTravelZ);
    const targetHeading = (travelMag > 0.0005) ? Math.atan2(this._smoothTravelX, this._smoothTravelZ) : this.heading;
    let diff = targetHeading - this.cameraHeading;
    if (isFinite(diff)) {
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      // Responsive camera tracking so camera stays tightly locked behind skier over water and land
      const headingSmooth = 1 - Math.pow(0.0001, frameDt);
      this.cameraHeading += diff * headingSmooth;
    }

    // Base camera parameters (higher downward angle to frame skier prominently)
    const targetCamDist = 10.5;
    const pitchForCam = this.state === 'riding' ? this._chairLookPitch : this.cameraPitch;
    const targetCamHeight = 9.5 + pitchForCam * 5; 

    // Camera Collision & Obstruction Avoidance
    // We check the terrain height at the camera position and midway to the skier.
    // If the terrain is too high, we calculate an 'ideal' pull-in amount.
    let effectiveCamHeading = this.cameraHeading;
    if (this.state === 'riding') {
      effectiveCamHeading = this.cameraHeading + this._chairLookYaw;
    }

    let collisionDist = targetCamDist;
    let collisionHeightBonus = 0;

    for (let i = 0; i < 3; i++) {
      const testX = x - Math.sin(effectiveCamHeading) * collisionDist;
      const testZ = z - Math.cos(effectiveCamHeading) * collisionDist;
      const terrainHAtCam = this.terrain.getInterpolatedHeight(testX, testZ);
      
      if (isFinite(terrainHAtCam) && terrainHAtCam > h + 1.0) {
        // If the terrain behind us is higher than the skier's feet, pull in and push up.
        collisionDist *= 0.75;
        collisionHeightBonus += 1.5;
      } else {
        break;
      }
    }

    // Smoothly interpolate the actual distance and height bonus to prevent popping/jitter
    if (this._currentCamDist === undefined) this._currentCamDist = targetCamDist;
    if (this._currentCamHeightBonus === undefined) this._currentCamHeightBonus = 0;
    
    // Faster smoothing for pull-in (collision), slower for return
    const isPullingIn = collisionDist < this._currentCamDist;
    const distSmooth = 1 - Math.pow(isPullingIn ? 0.00001 : 0.001, frameDt);
    this._currentCamDist += (collisionDist - this._currentCamDist) * distSmooth;
    this._currentCamHeightBonus += (collisionHeightBonus - this._currentCamHeightBonus) * distSmooth;

    const camX = x - Math.sin(effectiveCamHeading) * this._currentCamDist;
    const camZ = z - Math.cos(effectiveCamHeading) * this._currentCamDist;
    let camY = h + targetCamHeight + this._currentCamHeightBonus;

    const terrainHAtCamFinal = this.terrain.getInterpolatedHeight(camX, camZ);
    const waveOffsetCam = this.water ? this.water.getWaveHeight(camX, camZ) : 0;
    const waveHCam = (this.seaLevel !== undefined ? this.seaLevel : 0) + waveOffsetCam;
    const isCamOverWater = isFinite(terrainHAtCamFinal) && terrainHAtCamFinal <= this.seaLevel;
    const surfaceHAtCam = isCamOverWater ? waveHCam : (isFinite(terrainHAtCamFinal) ? terrainHAtCamFinal : -Infinity);
    const minHeightAboveGround = 2.5;
    if (isFinite(surfaceHAtCam) && camY < surfaceHAtCam + minHeightAboveGround) {
      camY = surfaceHAtCam + minHeightAboveGround;
    }

    // NaN guard on camY
    if (!isFinite(camY)) camY = h + targetCamHeight;

    // Frame-rate independent vertical smoothing — time constant ~1.8s prevents Y-axis jumpiness
    if (this._smoothCamY === undefined || !isFinite(this._smoothCamY)) this._smoothCamY = camY;
    const ySmooth = 1 - Math.pow(0.01, frameDt);
    this._smoothCamY += (camY - this._smoothCamY) * ySmooth;
    if (!isFinite(this._smoothCamY)) this._smoothCamY = camY;

    // Aim focus point right at the skier's body/skis for a clear downward view
    const lookYMultiplier = this.state === 'riding' ? 9.0 : 6.0;
    const lookY = h + 0.4 + pitchForCam * lookYMultiplier;
    if (this._smoothLookY === undefined || !isFinite(this._smoothLookY)) this._smoothLookY = lookY;
    const lookYSmooth = 1 - Math.pow(0.005, frameDt);
    this._smoothLookY += (lookY - this._smoothLookY) * lookYSmooth;
    if (!isFinite(this._smoothLookY)) this._smoothLookY = lookY;

    this._camPosVec.set(camX, this._smoothCamY, camZ);
    this._lookAtVec.set(x, this._smoothLookY, z);
    return { position: this._camPosVec, lookAt: this._lookAtVec };
  }

  /** Toggle parachute flight state or launch from ground */
  toggleParachute() {
    if (this.state === 'riding' || this.state === 'waiting') return;

    if (this.grounded) {
      // Direct parachute launch from the snow/ground
      this.grounded = false;
      this.vy = Math.max(this.vy, 5.0);
      this.paragliding = true;
    } else {
      // Toggle parachute state in mid-air
      this.paragliding = !this.paragliding;
    }
  }

  // ---- Input handlers ----
  _onKeyDown(e) {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
    switch (e.key) {
      case 'ArrowLeft':  case 'a': case 'A': e.preventDefault(); this._keys.left = true; break;
      case 'ArrowRight': case 'd': case 'D': e.preventDefault(); this._keys.right = true; break;
      case 'ArrowUp':    case 'w': case 'W': e.preventDefault(); this._keys.forward = true; this._keys.lookUp = true; break;
      case 'ArrowDown':  case 's': case 'S': e.preventDefault(); this._keys.brake = true; this._keys.lookDown = true; break;
      case 'Shift':      case 'z': case 'Z': case 'c': case 'C': e.preventDefault(); this._keys.grab = true; break;
      case 'x': case 'X':
        this._keys.paraglide = true;
        this.toggleParachute();
        break;
      case ' ':            e.preventDefault(); this._keys.jump = true; break;
    }
  }

  _onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft':  case 'a': case 'A': this._keys.left = false; break;
      case 'ArrowRight': case 'd': case 'D': this._keys.right = false; break;
      case 'ArrowUp':    case 'w': case 'W': this._keys.forward = false; this._keys.lookUp = false; break;
      case 'ArrowDown':  case 's': case 'S': this._keys.brake = false; this._keys.lookDown = false; break;
      case 'Shift':      case 'z': case 'Z': case 'c': case 'C': this._keys.grab = false; break;
      case 'x': case 'X':  this._keys.paraglide = false; break;
      case ' ':            this._keys.jump = false; break;
    }
  }

  // ---- Water Splash Particle System ----

  /** Get or create a splash particle from the pool */
  _getSplashParticle() {
    // Reuse an inactive particle
    for (const p of this._splashPool) {
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        return p;
      }
    }
    // Create a new one if pool not full
    if (this._splashPool.length < this._splashPoolSize) {
      const mesh = new THREE.Mesh(this._splashGeo, this._splashMat.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      const p = { mesh, active: true, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0 };
      this._splashPool.push(p);
      return p;
    }
    // Pool full, steal the oldest
    const oldest = this._splashPool[0];
    oldest.active = true;
    oldest.mesh.visible = true;
    return oldest;
  }

  /** Emit a single splash particle at the given world position */
  _emitSplash(wx, waterY, wz) {
    const p = this._getSplashParticle();
    
    // Offset sideways from skier center (to the left/right ski)
    const sideOffset = (Math.random() - 0.5) * 0.3;
    const fwdOffset = (Math.random() - 0.5) * 0.4;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    
    p.mesh.position.set(
      wx + cosH * sideOffset + sinH * fwdOffset,
      waterY + 0.05 + Math.random() * 0.1,
      wz - sinH * sideOffset + cosH * fwdOffset
    );
    
    // Spray outward and upward — velocity based on skier speed
    const speedFactor = Math.min(this.speed * 0.15, 2.5);
    const spreadAngle = (Math.random() - 0.5) * Math.PI * 0.8;
    const launchAngle = this.heading + Math.PI + spreadAngle; // Spray backward
    
    p.vx = Math.sin(launchAngle) * speedFactor * (0.5 + Math.random() * 0.5);
    p.vy = 1.5 + Math.random() * 2.5 * speedFactor; // Upward spray
    p.vz = Math.cos(launchAngle) * speedFactor * (0.5 + Math.random() * 0.5);
    
    p.life = 0;
    p.maxLife = 0.4 + Math.random() * 0.4; // 0.4–0.8 seconds
    
    // Randomize size
    const scale = 0.4 + Math.random() * 1.0;
    p.mesh.scale.setScalar(scale);
  }

  /** Animate all active splash particles */
  _updateSplashParticles(dt) {
    const gravity = 12.0;
    for (const p of this._splashPool) {
      if (!p.active) continue;
      
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      
      // Physics
      p.vy -= gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      
      // Don't go below water level
      if (p.mesh.position.y < this.seaLevel) {
        p.mesh.position.y = this.seaLevel;
        p.vy = 0;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      
      // Fade out
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = 0.7 * (1 - t * t); // Quadratic fade
      
      // Shrink slightly at end of life
      if (t > 0.6) {
        const shrink = 1 - (t - 0.6) / 0.4;
        p.mesh.scale.setScalar(p.mesh.scale.x * (0.95 + shrink * 0.05));
      }
    }
  }

  // ---- Snow Powder Particle System ----

  /** Get or create a snow particle from the pool */
  _getSnowParticle() {
    // Reuse an inactive particle
    for (const p of this._snowPool) {
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        return p;
      }
    }
    // Create a new one if pool not full
    if (this._snowPool.length < this._snowPoolSize) {
      // Small, delicate geometry for realistic low powder spray
      const geo = new THREE.IcosahedronGeometry(0.12, 0);
      const mesh = new THREE.Mesh(geo, this._snowMat.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      const p = { mesh, active: true, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseScale: 1 };
      this._snowPool.push(p);
      return p;
    }
    // Pool full, steal the oldest
    const oldest = this._snowPool[0];
    oldest.active = true;
    oldest.mesh.visible = true;
    return oldest;
  }

  /** Emit a subtle, translucent powder spray particle right behind the ski tails */
  _emitSnow(wx, snowY, wz) {
    const p = this._getSnowParticle();
    
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);

    // Position particle right behind the tail of the skis, low to ground
    const sideOffset = (Math.random() - 0.5) * 0.4;
    const tailDist = 0.3 + Math.random() * 0.3; // behind boots/skis
    
    p.mesh.position.set(
      wx - sinH * tailDist + cosH * sideOffset,
      snowY + 0.03 + Math.random() * 0.08,
      wz - cosH * tailDist - sinH * sideOffset
    );
    
    // Low upward float (hugs snow level)
    p.vy = 0.10 + Math.random() * 0.28 + Math.abs(this.angularVelocity || 0) * 0.35;

    // Backward and slight lateral fan out behind the ski tails
    const speedFactor = Math.min(this.speed * 0.15, 2.5);
    const spreadAngle = (Math.random() - 0.5) * Math.PI * 0.7;
    const launchAngle = this.heading + Math.PI + spreadAngle;

    p.vx = Math.sin(launchAngle) * speedFactor * (0.35 + Math.random() * 0.5);
    p.vz = Math.cos(launchAngle) * speedFactor * (0.35 + Math.random() * 0.5);
    
    p.life = 0;
    p.maxLife = 0.32 + Math.random() * 0.28; // 0.32–0.60 seconds for soft floating wake
    
    p.baseScale = 0.18 + Math.random() * 0.25;
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.material.opacity = 0.16; // Soft, translucent haze
    
    p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  /** Animate all active snow particles */
  _updateSnowParticles(dt) {
    const gravity = 1.2; // Very gentle downward settle
    for (const p of this._snowPool) {
      if (!p.active) continue;
      
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      
      // Horizontal drag
      p.vx *= 0.93;
      p.vz *= 0.93;
      
      // Physics: soft upward floating that gently settles
      p.vy -= gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      
      const terrainH = this.terrain.getInterpolatedHeight(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < terrainH) {
        p.mesh.position.y = terrainH;
        p.vy = 0;
        p.vx *= 0.4;
        p.vz *= 0.4;
      }
      
      // Soft translucent fade
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = 0.16 * (1.0 - t * t);
      
      // Soft scale expansion into translucent haze
      p.mesh.scale.setScalar(p.baseScale * (1.0 + t * 1.2));
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
    this._torso = torso;

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      this._skinMat
    );
    head.position.y = 0.5;
    head.castShadow = true;
    group.add(head);
    this._head = head;

    // Helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      this._bodyMat
    );
    helmet.position.y = 0.5;
    helmet.castShadow = true;
    group.add(helmet);
    this._helmet = helmet;

    // Legs
    const leftLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.20, 0.06),
      this._pantsMat
    );
    leftLeg.position.set(-0.04, 0.12, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);
    this._leftLeg = leftLeg;

    const rightLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.20, 0.06),
      this._pantsMat
    );
    rightLeg.position.set(0.04, 0.12, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);
    this._rightLeg = rightLeg;

    // Skis
    const leftSki = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.03, 0.7),
      this._skiMat
    );
    leftSki.position.set(-0.09, 0.015, 0);
    leftSki.castShadow = true;
    group.add(leftSki);
    this._leftSki = leftSki;

    const rightSki = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.03, 0.7),
      this._skiMat
    );
    rightSki.position.set(0.09, 0.015, 0);
    rightSki.castShadow = true;
    group.add(rightSki);
    this._rightSki = rightSki;

    // Poles
    const leftPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4),
      this._skiMat
    );
    leftPole.position.set(-0.18, 0.22, 0);
    leftPole.rotation.z = -0.2;
    group.add(leftPole);
    this._leftPole = leftPole;

    const rightPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4),
      this._skiMat
    );
    rightPole.position.set(0.18, 0.22, 0);
    rightPole.rotation.z = 0.2;
    group.add(rightPole);
    this._rightPole = rightPole;

    group.scale.setScalar(0.8); // Slightly larger than AI skiers
    return group;
  }

  // ---- Standalone Parachute builder (attached directly to skier container) ----
  _buildParachute() {
    const chuteGroup = new THREE.Group();
    const chuteMat = new THREE.MeshStandardMaterial({ color: 0xef233c, roughness: 0.8, side: THREE.DoubleSide });
    const chuteMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4),
      chuteMat
    );
    chuteMesh.scale.set(1.8, 0.6, 0.7); // Stretch horizontally, squash to make a rectangular canopy
    chuteMesh.position.y = 2.2; // High above skier
    chuteGroup.add(chuteMesh);
    
    // Strings
    const stringMat = new THREE.LineBasicMaterial({ color: 0x2b2d42 });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      // Calculate rim position considering the canopy scale
      const rimRadius = 1.5 * Math.sin(Math.PI * 0.4);
      const px = Math.cos(angle) * rimRadius * 1.8;
      const pz = Math.sin(angle) * rimRadius * 0.7;
      const py = 2.2 + (1.5 * Math.cos(Math.PI * 0.4) * 0.6); // mesh Y + scaled rim Y

      const points = [
        new THREE.Vector3(0, 0.3, 0), // from skier hands/shoulders
        new THREE.Vector3(px, py, pz) // to parachute rim
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const string = new THREE.Line(lineGeo, stringMat);
      chuteGroup.add(string);
    }
    
    chuteGroup.visible = false;
    chuteGroup.scale.setScalar(0.8);
    return chuteGroup;
  }
  setTrailsVisible(visible) {
    this._trailsVisible = visible;
    if (this._leftTrail) this._leftTrail.visible = this._trailsVisible;
    if (this._rightTrail) this._rightTrail.visible = this._trailsVisible;
  }
}
