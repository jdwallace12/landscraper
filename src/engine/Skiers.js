import * as THREE from 'three';

/**
 * Skier entity that follows the steepest downhill gradient on the terrain.
 * Builds a tiny low-poly stick figure with skis.
 */

export class Skiers {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.skiers = []; // { mesh, wx, wz, vx, vz, active, trail }
    this._tmpColor = new THREE.Color();
  }

  /** Drop a new skier at world position (wx, wz) */
  spawn(wx, wz) {
    const h = this.terrain.getInterpolatedHeight(wx, wz);

    const mesh = this._buildSkier();
    mesh.position.set(wx, h + 0.15, wz);
    this.group.add(mesh);

    // Trail line (ski tracks)
    const trailMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.9 });
    const trailGeo = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(2000 * 3); // max 2000 trail points
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, trailMat);
    this.group.add(trail);

    this.skiers.push({
      mesh,
      wx, wz,
      vx: 0, vz: 0,
      active: true,
      trail,
      trailPoints: [],
      speed: 0,
      timeAlive: 0,
      state: 'skiing',
      targetStation: null,
      targetLine: null,
      chair: null,
    });
  }

  /** Update all skiers — call each frame with deltaTime, seaLevel, and chairlifts ref */
  update(dt, seaLevel, chairlifts) {
    const gravity = 10.0;
    const friction = 0.97;
    const minSpeed = 0.001;
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const half = size / 2;

    for (const s of this.skiers) {
      if (!s.active) continue;

      // Get grid position
      const { gx, gz } = this.terrain.worldToGrid(s.wx, s.wz);
      if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }

      if (s.state === 'walking') {
        const dx = s.targetStation.x - s.wx;
        const dz = s.targetStation.z - s.wz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 2.0) {
          s.state = 'waiting';
          s.mesh.visible = false; // Hide inside the base station building!
        } else {
          s.wx += (dx / dist) * dt * 2.0; // Walk speed
          s.wz += (dz / dist) * dt * 2.0;
          const { gx: wgx, gz: wgz } = this.terrain.worldToGrid(s.wx, s.wz);
          const newH = this.terrain.getHeight(wgx, wgz);
          s.mesh.position.set(s.wx, newH + 0.15, s.wz);
          s.mesh.rotation.y = Math.atan2(dx, dz);
        }
        continue;
      }

      if (s.state === 'waiting') {
        // Look for an empty chair arriving at the base
        const isP1Base = s.targetLine.p1.y < s.targetLine.p2.y;
        const baseProgress = isP1Base ? 0.0 : 0.5;
        
        for (const chair of s.targetLine.chairs) {
           if (chair.passenger) continue;
           
           let pDiff = Math.abs(chair.progress - baseProgress);
           if (pDiff > 0.5) pDiff = 1.0 - pDiff;
           
           if (pDiff < 0.08) { // Close enough to board
              chair.passenger = s;
              s.chair = chair;
              s.state = 'riding';
              s.mesh.visible = true;
              break;
           }
        }
        continue;
      }

      if (s.state === 'riding') {
         const p = s.chair.mesh.position;
         const chairAngle = s.chair.mesh.rotation.y;
         // sit sideways
         s.mesh.position.set(p.x, p.y - 1.2, p.z);
         s.mesh.rotation.y = chairAngle + Math.PI / 2;
         
         const isP1Base = s.targetLine.p1.y < s.targetLine.p2.y;
         const peakProgress = isP1Base ? 0.5 : 0.0; // Dismount at peak
         
         let pDiff = Math.abs(s.chair.progress - peakProgress);
         if (pDiff > 0.5) pDiff = 1.0 - pDiff;
         
         if (pDiff < 0.05) { 
            s.chair.passenger = null;
            s.chair = null;
            s.state = 'skiing';
            
            s.wx = s.mesh.position.x;
            s.wz = s.mesh.position.z;
            s.vx = 0;
            s.vz = 0;
            s.speed = 0;
            s.trailPoints = [];
            s.trail.geometry.setDrawRange(0, 0);

            // push off
            s.wx += Math.cos(chairAngle) * 3;
            s.wz -= Math.sin(chairAngle) * 3;
         }
         continue;
      }

      // --- Skiing State ---

      // Compute gradient (steepest descent)
      const hL = this.terrain.getHeight(gx - 1, gz);
      const hR = this.terrain.getHeight(gx + 1, gz);
      const hU = this.terrain.getHeight(gx, gz - 1);
      const hD = this.terrain.getHeight(gx, gz + 1);

      const cellSize = size / (res - 1);
      const gradX = (hR - hL) / (2 * cellSize);
      const gradZ = (hD - hU) / (2 * cellSize);

      // Apply gravity along slope
      s.vx -= gradX * gravity * dt;
      s.vz -= gradZ * gravity * dt;

      // Friction
      s.vx *= friction;
      s.vz *= friction;

      s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);

      // Stop if too slow and on flat ground
      if (s.speed < minSpeed && Math.abs(gradX) < 0.001 && Math.abs(gradZ) < 0.001) {
        this._handleStop(s, chairlifts);
        continue;
      }

      s.timeAlive += dt;

      // Calculate perpendicular (cross) vector to current velocity for carving
      let carveX = 0, carveZ = 0;
      if (s.speed > 0.01) {
        // perpendicular to [vx, vz] is [-vz, vx]
        const px = -s.vz / s.speed;
        const pz = s.vx / s.speed;
        // Wider oscillation
        const carveStrength = Math.min(s.speed * 1.0, 4.0); 
        const carveForce = Math.sin(s.timeAlive * 3.0) * carveStrength;
        carveX = px * carveForce;
        carveZ = pz * carveForce;
      }

      // Move with both forward velocity and lateral carve velocity
      s.wx += (s.vx + carveX) * dt;
      s.wz += (s.vz + carveZ) * dt;

      // Get new height
      const { gx: ngx, gz: ngz } = this.terrain.worldToGrid(s.wx, s.wz);
      if (ngx < 0 || ngx >= res || ngz < 0 || ngz >= res) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const newH = this.terrain.getInterpolatedHeight(s.wx, s.wz);

      // Update mesh position
      s.mesh.position.set(s.wx, newH + 0.15, s.wz);

      // Stop if below the snow line (rock starts at seaLevel + 28)
      if (newH < seaLevel + 28) {
        this._handleStop(s, chairlifts);
        continue;
      }

      // Smoothly face direction of overall movement (velocity + carve)
      if (s.speed > 0.01) {
        const targetRot = Math.atan2(s.vx + carveX, s.vz + carveZ);
        // Lerp rotation to remove jumpiness: if difference is huge (like passing Math.PI), just snap, else lerp
        let diff = targetRot - s.mesh.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        s.mesh.rotation.y += diff * 6.0 * dt; // Smoothly arrive at target
      }

      // Trail
      if (s.trailPoints.length < 2000 * 3) {
        s.trailPoints.push(s.wx, newH + 0.05, s.wz);
        const posAttr = s.trail.geometry.attributes.position;
        const idx = s.trailPoints.length / 3 - 1;
        posAttr.setXYZ(idx, s.wx, newH + 0.05, s.wz);
        posAttr.needsUpdate = true;
        s.trail.geometry.setDrawRange(0, s.trailPoints.length / 3);
      }
    }
  }

  /** Remove all skiers and trails */
  _handleStop(s, chairlifts) {
    let closestBase = null;
    let closestDistSq = Infinity; // Find ANY lift on the map
    let targetLine = null;

    if (chairlifts) {
      for (const line of chairlifts.lines) {
        const base = line.p1.y < line.p2.y ? line.p1 : line.p2;
        const distSq = (s.wx - base.x) ** 2 + (s.wz - base.z) ** 2;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestBase = base;
          targetLine = line;
        }
      }
    }

    if (closestBase) {
      s.state = 'walking';
      s.targetStation = closestBase;
      s.targetLine = targetLine;
    } else {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  clear() {
    for (const s of this.skiers) {
      this.group.remove(s.mesh);
      this.group.remove(s.trail);
      s.mesh.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      s.trail.geometry.dispose();
      s.trail.material.dispose();
    }
    this.skiers = [];
  }

  get count() {
    return this.skiers.length;
  }

  get activeCount() {
    return this.skiers.filter(s => s.active).length;
  }

  _buildSkier() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.6 }); // red jacket
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.7 }); // dark pants
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf4d4b0, roughness: 0.8 });
    const skiMat = new THREE.MeshStandardMaterial({ color: 0xffa500, roughness: 0.3, metalness: 0.2 });

    // Body (torso)
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, 0.08),
      bodyMat
    );
    torso.position.y = 0.28;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 6),
      skinMat
    );
    head.position.y = 0.42;
    head.castShadow = true;
    group.add(head);

    // Legs
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.16, 0.05),
        pantsMat
      );
      leg.position.set(side * 0.035, 0.12, 0);
      leg.castShadow = true;
      group.add(leg);
    }

    // Skis
    for (const side of [-1, 1]) {
      const ski = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.03, 0.6),
        skiMat
      );
      ski.position.set(side * 0.08, 0.015, 0);
      ski.castShadow = true;
      group.add(ski);
    }

    // Poles (thin cylinders)
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4),
        skiMat
      );
      pole.position.set(side * 0.16, 0.2, 0);
      pole.rotation.z = side * 0.2;
      group.add(pole);
    }

    group.scale.setScalar(0.7);
    return group;
  }
}
