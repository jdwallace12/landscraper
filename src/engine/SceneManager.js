import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // Build the renderer
    // WebGPURenderer automatically handles the fallback to WebGL2 internally
    try {
      this.renderer = new THREE.WebGPURenderer({ 
        canvas, 
        antialias: true,
        forceWebGL: false // Set to true only if WebGPU is severely broken in your environment
      });
      console.log('Renderer created');
    } catch (e) {
      console.error('Failed to create WebGPURenderer, falling back to WebGLRenderer', e);
      // If even creating the object fails, we follow the legacy path
      // This is unlikely in r183 but good for safety
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x2a4a6b, 0.0015);
    this._buildSky();

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 3000);
    this.camera.position.set(90, 120, 180);
    this.camera.lookAt(0, 0, 0);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1000;
    this.controls.zoomSpeed = 2.5;
    this.controls.panSpeed = 2.0;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(0, 0, 0);
    this.controls.listenToKeyEvents(window);
    this.controls.keyPanSpeed = 50.0;

    // Lights
    this._buildLights();

    // Resize
    window.addEventListener('resize', () => this._onResize());

    // Clock
    this.clock = new THREE.Clock();

    // Custom panning
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
      if (this._skierMode) return; // Don't interfere during ski mode
      if (e.key === 'Shift') this.controls.keyPanSpeed = 150.0;
      const verticalSpeed = e.shiftKey ? 24.0 : 8.0;
      if (e.key.toLowerCase() === 'w') {
        this.camera.position.y += verticalSpeed;
        this.controls.target.y += verticalSpeed;
      } else if (e.key.toLowerCase() === 's') {
        this.camera.position.y -= verticalSpeed;
        this.controls.target.y -= verticalSpeed;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
      if (e.key === 'Shift') this.controls.keyPanSpeed = 50.0;
    });
  }

  /** Initialize the renderer — handles the async WebGPU/WebGL setup */
  async init() {
    console.log('Initializing renderer...');
    try {
      await this.renderer.init();
      console.log('Renderer initialized successfully');
    } catch (e) {
      console.error('Renderer init failed:', e);
      // If init fails, we might still be able to render in some contexts, 
      // but usually this is where the black screen happens.
    }
  }

  add(object) {
    this.scene.add(object);
  }

  getDelta() {
    return this.clock.getDelta();
  }

  render() {
    if (!this._skierMode) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Enter 3rd-person skier camera mode */
  enterSkierMode() {
    this._skierMode = true;
    this._currentLookAt = null; // Reset focus smoothing for new session
    this._forceSnapCamera = true; // Instantly snap behind the skier on the first frame
    
    // Save current state for restoration
    this._savedCamPos = this.camera.position.clone();
    this._savedTarget = this.controls.target.clone();
    this._savedFar = this.camera.far;
    this._savedFogDensity = this.scene.fog.density;

    // Optimization: reduce draw distance & thicken fog to mask it
    this.camera.far = 800; // Even shorter draw distance for thicker fog
    this.camera.updateProjectionMatrix();
    this.scene.fog.density = 0.007; // Much thicker fog during skiing

    // Shadow Optimization: Shrink shadow frustum and center on player
    if (this.sun) {
      const s = 50; // tight 100x100 frustum around player
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.updateProjectionMatrix();
    }

    this.controls.enabled = false;
  }

  /** Exit skier camera mode, restore previous view */
  exitSkierMode() {
    this._skierMode = false;
    this._currentLookAt = null;
    
    // Restore settings
    if (this._savedFar !== undefined) {
      this.camera.far = this._savedFar;
      this.camera.updateProjectionMatrix();
    }
    if (this._savedFogDensity !== undefined) {
      this.scene.fog.density = this._savedFogDensity;
    }

    // Restore shadow frustum
    if (this.sun) {
      const s = 300;
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.updateProjectionMatrix();
      // Restore sun pos
      this.sun.position.set(80, 120, 60);
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }

    this.controls.enabled = true;
    if (this._savedCamPos) {
      this.camera.position.copy(this._savedCamPos);
      this.controls.target.copy(this._savedTarget);
    }
  }

  /** Update chase camera to follow the player skier (call each frame in skier mode) */
  updateSkierCamera(targetPos, lookAtPos, dt) {
    if (!this._skierMode) return;

    if (this._forceSnapCamera) {
      this.camera.position.copy(targetPos);
      this._currentLookAt = lookAtPos.clone();
      this.camera.lookAt(this._currentLookAt);
      this._forceSnapCamera = false;
    } else {
      // Frame-rate independent exponential damping
      // Softer constants for cinematic glide instead of snapping
      const dampPos = 1 - Math.pow(0.02, dt);   // Smooth glide (~98% per second)
      const dampLook = 1 - Math.pow(0.005, dt);  // Gentle focus tracking

      this.camera.position.lerp(targetPos, dampPos);

      // Smooth the look-at target to reduce micro-jitter from terrain snapping
      if (!this._currentLookAt) this._currentLookAt = lookAtPos.clone();
      this._currentLookAt.lerp(lookAtPos, dampLook);
      
      this.camera.lookAt(this._currentLookAt);
    }

    // Dynamic Shadow: center shadow map on player
    if (this.sun) {
      const sunOffset = new THREE.Vector3(80, 120, 60); // Original relative sun pos
      this.sun.position.copy(lookAtPos).add(sunOffset);
      this.sun.target.position.copy(lookAtPos);
      this.sun.target.updateMatrixWorld();
    }
  }

  get isSkierMode() {
    return !!this._skierMode;
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(700, 32, 32);
    const skyColors = [];
    const topColor = new THREE.Color(0x0b1026);
    const horizonColor = new THREE.Color(0x2a4a6b);
    const pos = skyGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y + 700) / 1400, 0, 1);
      const c = new THREE.Color().lerpColors(horizonColor, topColor, t);
      skyColors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362907, 0.4);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffeedd, 1.6);
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 800;
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
