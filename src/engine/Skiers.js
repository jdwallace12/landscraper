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
    this._chairlifts = null; // cached reference for attraction forces
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
      carvePhase: Math.random() * Math.PI * 2, // unique carve offset so skiers don't turn in sync
      traverseTimeLeft: 0,
      traverseDir: 1,
    });
  }

  /** Update all skiers — call each frame with deltaTime, seaLevel, and chairlifts ref */
  update(dt, seaLevel, chairlifts, isSnowing = false) {
    const gravity = 10.0;
    const friction = 0.98;
    const minSpeed = 0.001;
    this._chairlifts = chairlifts;
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const half = size / 2;

    for (const s of this.skiers) {
      // Trail Fading/Overwriting
      let fadePointsCount = isSnowing ? 6 : 0; // If snowing, remove old tracks over time (2 nodes per frame)
      
      // Also shift if we exceed max points
      while (s.active && s.trailPoints.length >= 2000 * 3) {
        s.trailPoints.splice(0, 3);
      }
      
      if (fadePointsCount > 0 && s.trailPoints.length > 0) {
        s.trailPoints.splice(0, Math.min(fadePointsCount, s.trailPoints.length));
      }

      // Update trail geometry buffer for active and inactive (if they still have tracks fading)
      if (s.trailPoints.length > 0 || isSnowing) {
         const posAttr = s.trail.geometry.attributes.position;
         posAttr.array.set(s.trailPoints);
         posAttr.needsUpdate = true;
         s.trail.geometry.setDrawRange(0, s.trailPoints.length / 3);
      }

      if (!s.active) continue;

      // Walking, waiting, and riding states handle their own logic
      // Grid boundary check only applies to actively skiing
      if (s.state === 'walking') {
        const dx = s.targetStation.x - s.wx;
        const dz = s.targetStation.z - s.wz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 4.0) {
          s.state = 'waiting';
          s.mesh.visible = false; // Hide inside the base station building!
        } else {
          s.wx += (dx / dist) * dt * 8.0; // Walk speed
          s.wz += (dz / dist) * dt * 8.0;
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
        let bestChair = null;
        let bestPDiff = 0.03; // Wider window for boarding at the turnaround
        
        for (const chair of s.targetLine.chairs) {
           if (chair.passenger) continue;
           
           let pDiff = Math.abs(chair.progress - baseProgress);
           if (pDiff > 0.5) pDiff = 1.0 - pDiff;
           
           if (pDiff < bestPDiff) {
              bestPDiff = pDiff;
              bestChair = chair;
           }
        }
        
        if (bestChair) {
           bestChair.passenger = s;
           s.chair = bestChair;
           s.state = 'riding';
           
           s.mesh.visible = true;
        }
        continue;
      }

      if (s.state === 'riding') {
         const p = s.chair.mesh.position;
         const chairAngle = s.chair.mesh.rotation.y;
         // sit sideways — keep wx/wz in sync with chair
         s.wx = p.x;
         s.wz = p.z;
         // Sit a bit higher and more forward to ensure they aren't hidden inside the geometry
         s.mesh.position.set(p.x, p.y - 0.5, p.z);
         s.mesh.rotation.y = chairAngle + Math.PI / 2;
         s.mesh.scale.setScalar(1.0); // Make them larger temporarily!

         
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

            // Randomly choose left or right (-1 or 1)
            const sideOffset = Math.random() < 0.5 ? 1 : -1;
            const pushAngle = chairAngle + sideOffset * 1.0; // Angled to the side (~60 degrees)

            // push off
            s.wx += Math.cos(pushAngle) * 3;
            s.wz -= Math.sin(pushAngle) * 3;
            
            // Give them a slight initial velocity in that direction
            s.vx = Math.cos(pushAngle) * 4;
            s.vz = -Math.sin(pushAngle) * 4;

            // Start skiing straight, they will only traverse if they get too close to others
            s.traverseTimeLeft = 0; 
            s.traverseDir = sideOffset;
            
            s.mesh.scale.setScalar(0.7); // Scale back to normal
         }
         continue;
      }

      // --- Skiing State from here on ---

      // Get grid position (only for skiing state)
      const { gx, gz } = this.terrain.worldToGrid(s.wx, s.wz);
      if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }

      // Compute gradient using wider sampling (3-cell radius) to smooth over rough terrain
      const cellSize = size / (res - 1);
      const sampleR = 3; // sample radius in grid cells
      const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
      const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
      const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
      const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));

      const gradX = (hR - hL) / (2 * sampleR * cellSize);
      const gradZ = (hD - hU) / (2 * sampleR * cellSize);

      // Find nearest chairlift base first (needed to dampen gravity near bases)
      let nearestBaseDist = Infinity;
      let nearestBase = null;
      if (chairlifts && chairlifts.lines.length > 0) {
        let nearestDistSq = Infinity;
        for (const line of chairlifts.lines) {
          const base = line.p1.y < line.p2.y ? line.p1 : line.p2;
          const dbx = base.x - s.wx;
          const dbz = base.z - s.wz;
          const dSq = dbx * dbx + dbz * dbz;
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearestBase = base;
          }
        }
        if (nearestBase) {
          nearestBaseDist = Math.sqrt(nearestDistSq);
        }
      }

      // Apply gravity along slope — dampen when close to a chairlift base
      // so skiers can overpower the slope to reach the lift
      const gravityDampen = nearestBaseDist < 30.0
        ? Math.max(0.05, nearestBaseDist / 30.0)
        : 1.0;

      if (s.traverseTimeLeft > 0) {
        s.traverseTimeLeft -= dt;

        // The gradient vector is (gradX, gradZ), so downhill is (-gradX, -gradZ).
        // Orthogonal (contour line) depends on traverseDir.
        const contourX = gradZ * s.traverseDir;
        const contourZ = -gradX * s.traverseDir;
        const contourLen = Math.sqrt(contourX * contourX + contourZ * contourZ) || 1;
        
        // Push along the contour to traverse (cut)
        const traverseForceMag = 10.0; 
        s.vx += (contourX / contourLen) * traverseForceMag * dt;
        s.vz += (contourZ / contourLen) * traverseForceMag * dt;
        
        // Dampen the downhill gravity slightly during the cut so it's a diagonal sweep
        // Keeping this at 0.8 means the slope continues to pull them mostly downwards
        s.vx -= gradX * gravity * gravityDampen * 0.8 * dt;
        s.vz -= gradZ * gravity * gravityDampen * 0.8 * dt;
      } else {
        // Continue counting down into negative numbers to act as a cooldown timer
        s.traverseTimeLeft -= dt; 
        s.vx -= gradX * gravity * gravityDampen * dt;
        s.vz -= gradZ * gravity * gravityDampen * dt;
      }

      // Chairlift base attraction force while skiing
      if (nearestBase && nearestBaseDist < 80.0 && nearestBaseDist > 1.0) {
        
        // If they physically reached the base during skiing, stop and get in line!
        if (nearestBaseDist < 4.0) {
           this._handleStop(s, chairlifts);
           continue;
        }

        // Strong attraction that increases as skier gets closer
        const attractStrength = 4.0 * (1.0 - nearestBaseDist / 80.0);
        const adx = (nearestBase.x - s.wx) / nearestBaseDist;
        const adz = (nearestBase.z - s.wz) / nearestBaseDist;
        s.vx += adx * attractStrength * dt;
        s.vz += adz * attractStrength * dt;
      }

      // Skier-to-skier repulsion: spread out to find fresh snow
      // BUT disable near chairlift bases so skiers can converge to board
      if (nearestBaseDist > 25.0) {
        const repelRadius = 15.0;
        for (const other of this.skiers) {
          if (other === s || !other.active || other.state !== 'skiing') continue;
          const dx = s.wx - other.wx;
          const dz = s.wz - other.wz;
          const distSq = dx * dx + dz * dz;
          if (distSq < repelRadius * repelRadius && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            // Stronger, smoother repulsion to keep them in their own lanes without suddenly cutting
            const repelStrength = 6.0 * (1.0 - dist / repelRadius);
            s.vx += (dx / dist) * repelStrength * dt;
            s.vz += (dz / dist) * repelStrength * dt;
          }
        }
      }

      // Snow-seeking traverse: probe for snow-covered terrain and bias toward it
      const currentH = this.terrain.getInterpolatedHeight(s.wx, s.wz);
      const snowLine = seaLevel + 28;
      if (currentH < snowLine + 8) {
        // Probe 8 directions for higher/snowier terrain
        const probeDistWorld = 12.0;
        let bestDx = 0, bestDz = 0, bestScore = -Infinity;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
          const px = s.wx + Math.cos(angle) * probeDistWorld;
          const pz = s.wz + Math.sin(angle) * probeDistWorld;
          const ph = this.terrain.getInterpolatedHeight(px, pz);
          // Score: prefer terrain near/above snow line, penalize too-steep uphill
          const heightAboveSnow = ph - snowLine;
          const climbNeeded = Math.max(0, ph - currentH);
          const score = heightAboveSnow * 1.0 - climbNeeded * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestDx = Math.cos(angle);
            bestDz = Math.sin(angle);
          }
        }
        if (bestScore > -5) {
          // Gentle bias toward snowier terrain
          const traverseStrength = 0.8;
          s.vx += bestDx * traverseStrength * dt;
          s.vz += bestDz * traverseStrength * dt;
        }
      }

      // Friction
      s.vx *= friction;
      s.vz *= friction;

      s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);

      // Minimum downhill nudge: if nearly stopped but on a slope, give a small push
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);
      if (s.speed < 0.05 && gradMag > 0.005) {
        s.vx -= (gradX / gradMag) * 0.1;
        s.vz -= (gradZ / gradMag) * 0.1;
        s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      }

      // Stuck detection: require being slow for 3 seconds before fully stopping
      if (s.speed < minSpeed && gradMag < 0.003) {
        s.stuckTime = (s.stuckTime || 0) + dt;
        if (s.stuckTime > 3.0) {
          s.stuckTime = 0;
          this._handleStop(s, chairlifts);
          continue;
        }
      } else {
        s.stuckTime = 0;
      }

      s.timeAlive += dt;

      // Calculate perpendicular (cross) vector to current velocity for carving
      let carveX = 0, carveZ = 0;
      if (s.speed > 0.01) {
        // perpendicular to [vx, vz] is [-vz, vx]
        const px = -s.vz / s.speed;
        const pz = s.vx / s.speed;
        // Tighter, narrower oscillation to prevent path crossing
        const carveStrength = Math.min(s.speed * 0.8, 2.5); 
        const carveForce = Math.sin(s.timeAlive * 3.0 + s.carvePhase) * carveStrength;
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
      // UNLESS the surface has been covered with the Snow Maker tool
      const snowIdx = ngz * res + ngx;
      const hasSnowPaint = this.terrain.snowmap[snowIdx] > 0.3;
      if (newH < seaLevel + 28 && !hasSnowPaint) {
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

      // Trail points appending
      s.trailPoints.push(s.wx, newH + 0.15, s.wz);
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
