import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Scene
    this.scene = new THREE.Scene();
    this._buildSky();

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 1000);
    this.camera.position.set(60, 80, 120);
    this.camera.lookAt(0, 0, 0);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 300;
    this.controls.target.set(0, 0, 0);

    // Lights
    this._buildLights();

    // Resize
    window.addEventListener('resize', () => this._onResize());

    // Clock
    this.clock = new THREE.Clock();
  }

  add(object) {
    this.scene.add(object);
  }

  getDelta() {
    return this.clock.getDelta();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _buildSky() {
    // Gradient sky via a large sphere with vertex colors
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyColors = [];
    const topColor = new THREE.Color(0x0b1026);
    const horizonColor = new THREE.Color(0x2a4a6b);
    const pos = skyGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y + 400) / 800, 0, 1);
      const c = new THREE.Color().lerpColors(horizonColor, topColor, t);
      skyColors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  _buildLights() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
    this.scene.add(ambient);

    // Hemisphere
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362907, 0.4);
    this.scene.add(hemi);

    // Sun
    const sun = new THREE.DirectionalLight(0xffeedd, 1.6);
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
