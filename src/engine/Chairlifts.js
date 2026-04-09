import * as THREE from 'three';

/**
 * Procedural chairlift system.
 * User places Point A and Point B. This builds support towers along the line,
 * strings a cable, and animates chairs looping on the cable.
 */

export class Chairlifts {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.lines = []; // { group, length, chairs, p1, p2 }

    // Shared Materials
    this.matTower = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8, metalness: 0.6 }); // Dark grey metal
    this.matCable = new THREE.LineBasicMaterial({ color: 0x111111, linewidth: 2 });
    this.matChair = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.5 }); // Red chairs
  }

  /**
   * Build a complete chairlift line between world points p1 and p2.
   * Towers will stretch down to the terrain.
   */
  buildLine(p1, p2) {
    const lineGroup = new THREE.Group();
    
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const horizontalLength = Math.sqrt(dx * dx + dz * dz);
    if (horizontalLength < 5) return; // Too short!

    // Determine how many towers we need (1 every ~30 world units)
    const towerSpacing = 30;
    const towerCount = Math.max(2, Math.floor(horizontalLength / towerSpacing));
    const step = 1.0 / towerCount;

    // Cable path arrays
    const cablePoints = [];

    // Place towers
    for (let i = 0; i <= towerCount; i++) {
      const t = i * step;
      const tx = p1.x + dx * t;
      const tz = p1.z + dz * t;
      
      // Terrain height at this horizontal pos
      const { gx, gz } = this.terrain.worldToGrid(tx, tz);
      const h = this.terrain.getHeight(gx, gz);

      // Desired cable height (linear altitude between p1 and p2, but always +5 above start/end)
      const idealH = THREE.MathUtils.lerp(p1.y, p2.y, t) + 8.0;
      // Ensure tower is at least 3 units above terrain
      const cableH = Math.max(idealH, h + 3.0);

      cablePoints.push(new THREE.Vector3(tx, cableH, tz));

      // Build tower mesh
      const towerHeight = cableH - h;
      const towerGeo = new THREE.CylinderGeometry(0.1, 0.2, towerHeight, 4);
      towerGeo.translate(0, towerHeight / 2, 0);
      const towerMesh = new THREE.Mesh(towerGeo, this.matTower);
      towerMesh.position.set(tx, h, tz);
      towerMesh.castShadow = true;
      lineGroup.add(towerMesh);

      // Build crossbar
      const crossbarGeo = new THREE.BoxGeometry(1.6, 0.2, 0.2);
      const crossbar = new THREE.Mesh(crossbarGeo, this.matTower);
      crossbar.position.set(tx, cableH, tz);
      // Align crossbar perpendicular to the lift line
      crossbar.rotation.y = Math.atan2(dz, dx) + Math.PI / 2;
      crossbar.castShadow = true;
      lineGroup.add(crossbar);
    }

    // Build cables (left and right)
    const cableGeoLeft = new THREE.BufferGeometry().setFromPoints(cablePoints.map(p => {
      // offset perpendicular
      const angle = Math.atan2(dz, dx) + Math.PI / 2;
      return new THREE.Vector3(p.x + Math.cos(angle) * 0.75, p.y + 0.1, p.z + Math.sin(angle) * 0.75);
    }));
    const cableGeoRight = new THREE.BufferGeometry().setFromPoints(cablePoints.map(p => {
      const angle = Math.atan2(dz, dx) - Math.PI / 2;
      return new THREE.Vector3(p.x + Math.cos(angle) * 0.75, p.y + 0.1, p.z + Math.sin(angle) * 0.75);
    }));

    lineGroup.add(new THREE.Line(cableGeoLeft, this.matCable));
    lineGroup.add(new THREE.Line(cableGeoRight, this.matCable));

    // Measure actual 3D cable length
    let totalLength = 0;
    for (let i = 0; i < cablePoints.length - 1; i++) {
        totalLength += cablePoints[i].distanceTo(cablePoints[i+1]);
    }

    // Build Chairs
    const chairs = [];
    const chairCount = Math.floor(totalLength / 5); // chair every 5 units
    
    for (let i = 0; i < chairCount; i++) {
      const chairGrp = this._buildChair();
      
      const progress = i / chairCount;
      const isReturn = progress > 0.5;
      const normalizedT = (progress % 0.5) * 2; // 0 to 1 along the line
      
      chairs.push({
        mesh: chairGrp,
        progress: progress, // 0 to 1 loop
      });
      lineGroup.add(chairGrp);
    }

    // Build Station Cabins at top and bottom
    const angle = Math.atan2(dz, dx);
    const station1 = this._buildStation();
    station1.position.set(p1.x, p1.y, p1.z);
    station1.rotation.y = angle + Math.PI / 2;
    lineGroup.add(station1);

    const station2 = this._buildStation();
    station2.position.set(p2.x, p2.y, p2.z);
    station2.rotation.y = angle + Math.PI / 2;
    lineGroup.add(station2);

    this.group.add(lineGroup);

    this.lines.push({
      group: lineGroup,
      cablePoints,
      totalLength,
      chairs,
      dx, dz,
      p1: p1.clone(),
      p2: p2.clone()
    });
  }

  update(dt) {
    const chairSpeedPixelsPerSecond = 1.5; // world units per sec

    for (const line of this.lines) {
      const progressSpeed = chairSpeedPixelsPerSecond / (line.totalLength * 2);

      for (const chair of line.chairs) {
        chair.progress += progressSpeed * dt;
        if (chair.progress >= 1.0) chair.progress -= 1.0;

        const isReturn = chair.progress > 0.5;
        let t = isReturn ? 1.0 - ((chair.progress - 0.5) * 2) : chair.progress * 2;
        
        // Find segment
        const segmentCount = line.cablePoints.length - 1;
        const segmentT = t * segmentCount;
        const index = Math.floor(segmentT);
        const frac = segmentT - index;

        let pA, pB;
        if (index >= segmentCount) {
          pA = line.cablePoints[segmentCount];
          pB = pA;
        } else {
          pA = line.cablePoints[index];
          pB = line.cablePoints[index + 1];
        }

        const angle = Math.atan2(line.dz, line.dx);
        const offsetAngle = isReturn ? angle - Math.PI / 2 : angle + Math.PI / 2;
        
        const currentX = THREE.MathUtils.lerp(pA.x, pB.x, frac) + Math.cos(offsetAngle) * 0.75;
        const currentY = THREE.MathUtils.lerp(pA.y, pB.y, frac) + 0.1;
        const currentZ = THREE.MathUtils.lerp(pA.z, pB.z, frac) + Math.sin(offsetAngle) * 0.75;

        chair.mesh.position.set(currentX, currentY, currentZ);
        chair.mesh.rotation.y = isReturn ? angle + Math.PI : angle;
      }
    }
  }

  clear() {
    for (const line of this.lines) {
      this.group.remove(line.group);
      line.group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
      });
    }
    this.lines = [];
  }

  _buildChair() {
    const g = new THREE.Group();
    
    // Hanger pole
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });
    const poleObj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 4), poleMat);
    poleObj.position.y = -1.0;
    g.add(poleObj);

    // Bench
    const benchGeo = new THREE.BoxGeometry(1.6, 0.2, 0.6);
    const bench = new THREE.Mesh(benchGeo, this.matChair);
    bench.position.set(0, -2.0, 0);
    g.add(bench);

    // Backrest
    const backGeo = new THREE.BoxGeometry(1.6, 0.6, 0.1);
    const back = new THREE.Mesh(backGeo, this.matChair);
    back.position.set(0, -1.6, -0.25);
    g.add(back);

    g.scale.setScalar(0.4); // Make the entire chair tiny

    g.castShadow = true;
    return g;
  }

  _buildStation() {
    const g = new THREE.Group();
    
    // Main cabin block
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    
    // Cabin base
    const baseGeo = new THREE.BoxGeometry(4, 3, 3);
    baseGeo.translate(0, 1.5, 0);
    const base = new THREE.Mesh(baseGeo, cabinMat);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Awning/roof
    const roofGeo = new THREE.BoxGeometry(4.4, 0.4, 4);
    roofGeo.translate(0, 3.2, 0);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.castShadow = true;
    g.add(roof);

    // A dark empty doorway/opening for the chairs to go through
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0 });
    const doorGeo = new THREE.BoxGeometry(2.4, 2.0, 3.1);
    doorGeo.translate(0, 1.0, 0);
    const door = new THREE.Mesh(doorGeo, doorMat);
    g.add(door);

    g.scale.setScalar(0.7); // Fit the new tiny chairlift scale
    return g;
  }
}
