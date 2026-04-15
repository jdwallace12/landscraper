import * as THREE from 'three';

export class BrushEngine {
  constructor(terrain, camera, canvas) {
    this.terrain = terrain;
    this.camera = camera;
    this.canvas = canvas;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.intersectionPoint = null;

    this.tool = null;       // current tool object
    this.radius = 16;
    this.strength = 0.6;
    this.painting = false;
    this._isStart = false;

    // Brush cursor ring
    this.cursorMesh = this._buildCursor();

    // Events
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mouseleave', this._onMouseUp);

    // Touch events for mobile
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onMouseUp);
    canvas.addEventListener('touchcancel', this._onMouseUp);
  }

  setTool(tool) {
    this.tool = tool;
  }

  _updateRaycaster() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.mesh);

    if (hits.length > 0) {
      const pt = hits[0].point;
      this.intersectionPoint = pt;
      this.cursorMesh.visible = true;
      
      if (this.gridMesh) {
        this.gridMesh.visible = this.painting;
        if (this.painting) {
          this._updateTopoMesh();
        }
      }
      
      this.cursorMesh.position.set(pt.x, pt.y + 0.2, pt.z);
      // scale cursor to match brush radius in world units
      const worldRadius = (this.radius / this.terrain.resolution) * this.terrain.size;
      this.cursorMesh.scale.setScalar(worldRadius);
    } else {
      this.cursorMesh.visible = false;
      this.intersectionPoint = null;
    }
  }

  /** Call each frame; returns true if terrain was modified */
  update(seaLevel) {
    // Update raycaster
    this._updateRaycaster();


    // Apply tool
    if (this.painting && this.tool && this.intersectionPoint) {
      const { gx, gz } = this.terrain.worldToGrid(
        this.intersectionPoint.x,
        this.intersectionPoint.z
      );
      const mapToApply = this.tool.isSnowBrush ? this.terrain.snowmap : this.terrain.heightmap;
      this.tool.apply(
        mapToApply,
        this.terrain.resolution,
        gx, gz,
        this.radius,
        this.strength,
        this._isStart
      );
      this._isStart = false;
      const worldRadius = (this.radius / this.terrain.resolution) * this.terrain.size;
      this.terrain.updateMesh(seaLevel, this.intersectionPoint.x, this.intersectionPoint.z, worldRadius);
      return true;
    }
    return false;
  }

  updateCursorColor(color) {
    this.cursorMesh.children.forEach(child => {
      if (child.material) child.material.color.set(color);
    });
  }

  _buildCursor() {
    const group = new THREE.Group();

    // Ring
    const ringGeo = new THREE.RingGeometry(0.95, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 1.0, 
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.renderOrder = 1000;
    group.add(ringMesh);

    // Topographical Grid Overlay
    // Use a high-density plane that we can warp to follow the terrain
    const gridRes = 32;
    const gridGeo = new THREE.PlaneGeometry(1.9, 1.9, gridRes, gridRes);
    gridGeo.rotateX(-Math.PI / 2);
    
    // Create grid texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 128; i += 32) {
      ctx.moveTo(i, 0); ctx.lineTo(i, 128);
      ctx.moveTo(0, i); ctx.lineTo(128, i);
    }
    ctx.stroke();

    const gridTex = new THREE.CanvasTexture(canvas);
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(4, 4); 

    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      map: gridTex,
      transparent: true,
      opacity: 0.5,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    
    this.gridMesh = new THREE.Mesh(gridGeo, gridMat);
    this.gridMesh.renderOrder = 999;
    this.gridMesh.visible = false;
    group.add(this.gridMesh);

    group.visible = false;
    return group;
  }

  _updateTopoMesh() {
    if (!this.intersectionPoint || !this.gridMesh) return;
    
    const pos = this.gridMesh.geometry.attributes.position;
    const worldRadius = (this.radius / this.terrain.resolution) * this.terrain.size;
    const centerPt = this.intersectionPoint;
    const cursorElev = centerPt.y + 0.2; // Match cursorMesh.position offset
    
    for (let i = 0; i < pos.count; i++) {
       // Vertices are initially in [-0.95, 0.95] range
       const lx = pos.getX(i);
       const lz = pos.getZ(i);
       
       const wx = centerPt.x + lx * worldRadius;
       const wz = centerPt.z + lz * worldRadius;
       
       const h = this.terrain.getInterpolatedHeight(wx, wz);
       // Height relative to the cursor's anchor position
       // Divid by worldRadius because the group is scaled by worldRadius
       const localY = (h - cursorElev) / worldRadius;
       pos.setY(i, localY + 0.01); 
    }
    pos.needsUpdate = true;
  }

  _updateMouseFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onMouseMove(e) {
    this._updateMouseFromEvent(e);
  }

  _onTouchMove(e) {
    if (e.touches.length === 1) {
      this._updateMouseFromEvent(e);
    }
  }

  _onMouseDown(e) {
    // Only paint on left click and not when orbiting (middle / right)
    if (e.button !== undefined && e.button !== 0) return;
    // Don't paint if alt/meta is held (orbit shortcut)
    if (e.altKey || e.metaKey) return;
    this.painting = true;
    this._isStart = true;
  }

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      this._updateMouseFromEvent(e);
      // Immediately raycast so intersectionPoint is valid for touchstart listeners in main.js
      this._updateRaycaster();
      this.painting = true;
      this._isStart = true;
    }
  }

  _onMouseUp() {
    if (this.painting) {
      this.painting = false;
      // Reset tool state
      if (this.tool && this.tool._targetHeight !== undefined) {
        this.tool._targetHeight = null;
      }
    }
  }
}
