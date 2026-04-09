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
    this.radius = 8;
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
      this.cursorMesh.position.set(pt.x, pt.y + 0.3, pt.z);
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
      this.tool.apply(
        this.terrain.heightmap,
        this.terrain.resolution,
        gx, gz,
        this.radius,
        this.strength,
        this._isStart
      );
      this._isStart = false;
      this.terrain.updateMesh(seaLevel);
      return true;
    }
    return false;
  }

  updateCursorColor(color) {
    this.cursorMesh.material.color.set(color);
  }

  _buildCursor() {
    const geo = new THREE.RingGeometry(0.9, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 999;
    return mesh;
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
