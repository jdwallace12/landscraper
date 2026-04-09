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

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mouseleave', this._onMouseUp);
  }

  setTool(tool) {
    this.tool = tool;
  }

  /** Call each frame; returns true if terrain was modified */
  update(seaLevel) {
    // Update raycaster
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

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onMouseDown(e) {
    // Only paint on left click and not when orbiting (middle / right)
    if (e.button !== 0) return;
    // Don't paint if alt/meta is held (orbit shortcut)
    if (e.altKey || e.metaKey) return;
    this.painting = true;
    this._isStart = true;
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
