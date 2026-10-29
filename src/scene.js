import * as THREE from 'three';
import { lightPosition, clamp } from './core.js';

function studioSubject(material) {
  const group = new THREE.Group();
  const part = (geometry, position, scale) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); if (scale) mesh.scale.set(...scale); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  part(new THREE.SphereGeometry(0.6, 48, 32), [0, 0.7, 0], [0.79, 1.06, 0.87]);
  part(new THREE.SphereGeometry(0.2, 32, 24), [0, 0.57, 0.48], [0.38, 0.72, 0.62]);
  part(new THREE.SphereGeometry(0.3, 32, 24), [0, 0.31, 0.17], [1.12, 0.67, 1.0]);
  part(new THREE.CylinderGeometry(0.21, 0.27, 0.55, 48), [0, -0.01, 0]);
  part(new THREE.SphereGeometry(0.7, 48, 32), [0, -0.53, 0], [1.07, 0.5, 0.57]);
  part(new THREE.CylinderGeometry(0.53, 0.53, 0.12, 64), [0, -0.92, 0]);
  return group;
}

export class LightScene {
  constructor(container, onChange) {
    this.container = container; this.onChange = onChange;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x15181b, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    this.camera.position.set(3.8, 2.7, 5.7); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    this.scene.add(studioSubject(new THREE.MeshStandardMaterial({ color: 0xc8cbc6, roughness: 0.36, metalness: 0.12 })));
    const grid = new THREE.GridHelper(8, 16, 0x4a5048, 0x2b302e); grid.position.y = -1.02; this.scene.add(grid);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.008, 8, 100), new THREE.MeshBasicMaterial({ color: 0x636b58 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.95; this.scene.add(ring);
    const axis = new THREE.AxesHelper(1.15); axis.position.set(-2.5, -0.98, 1.7); this.scene.add(axis);
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '3D 打光參考，拖曳調整選取燈光的水平與仰角');
    canvas.addEventListener('pointerdown', e => { if (!this.current) return; this.drag = { x: e.clientX, y: e.clientY, ...this.current }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.onChange({ azimuth: (this.drag.azimuth + (e.clientX - this.drag.x) * 0.7 + 720) % 360, elevation: clamp(this.drag.elevation - (e.clientY - this.drag.y) * 0.5, -90, 90) });
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
  }
  resize() { const { width, height } = this.container.getBoundingClientRect(); this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.render(); }
  update(lights, selected) {
    for (const child of [...this.rig.children]) { this.rig.remove(child); child.geometry?.dispose(); child.material?.dispose(); }
    this.current = lights[selected];
    lights.forEach((l, i) => {
      const color = l.type === 'neutral' ? '#ffffff' : l.color;
      const pos = new THREE.Vector3(...lightPosition(l, 2.6));
      const light = new THREE.DirectionalLight(color, l.intensity * 0.7); light.position.copy(pos); this.rig.add(light);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(i === selected ? 0.13 : 0.09, 24, 16), new THREE.MeshBasicMaterial({ color })); sphere.position.copy(pos); this.rig.add(sphere);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.4, 0), pos]), new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.4, dashSize: 0.1, gapSize: 0.08 })); line.computeLineDistances(); this.rig.add(line);
      if (i === selected) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.66, pos.length(), 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false }));
        cone.position.copy(pos).multiplyScalar(0.5); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize()); this.rig.add(cone);
      }
    });
    this.render();
  }
  render() { this.renderer.render(this.scene, this.camera); }
}

export async function createDemoAssets() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(480, 480); renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5;
  const colors = [0xb5c98a, 0xe6a56c, 0xbac7d7, 0xd3b7bb, 0xe5d8ad, 0x819e91];
  const names = ['Knot', 'Vase', 'Orb', 'Loop', 'Totem', 'Pebble'];
  const files = [];
  for (let i = 0; i < 6; i++) {
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100); camera.position.set(3, 2, 5); camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const key = new THREE.DirectionalLight(0xfff0d8, 4); key.position.set(-3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xe0ebff, 2); fill.position.set(3, 1, -2); scene.add(fill);
    const material = new THREE.MeshPhysicalMaterial({ color: colors[i], roughness: 0.31, metalness: 0.13, clearcoat: 0.5 });
    let geometry;
    if (i === 0) geometry = new THREE.TorusKnotGeometry(0.7, 0.25, 160, 32);
    if (i === 1) geometry = new THREE.LatheGeometry([new THREE.Vector2(0.01, -1), new THREE.Vector2(0.65, -0.95), new THREE.Vector2(0.77, -0.3), new THREE.Vector2(0.6, 0.3), new THREE.Vector2(0.29, 0.62), new THREE.Vector2(0.27, 1), new THREE.Vector2(0.35, 1.06), new THREE.Vector2(0.23, 1.06), new THREE.Vector2(0.2, 0.9)], 64);
    if (i === 2) geometry = new THREE.IcosahedronGeometry(1.03, 1);
    if (i === 3) geometry = new THREE.TorusGeometry(0.77, 0.32, 48, 96);
    if (i === 4) geometry = new THREE.LatheGeometry(Array.from({ length: 80 }, (_, j) => { const y = j / 79 * 2.2 - 1.1; return new THREE.Vector2(0.4 + Math.pow(Math.cos(y * 4), 2) * 0.28, y); }), 64);
    if (i === 5) geometry = new THREE.SphereGeometry(1, 64, 48);
    const mesh = new THREE.Mesh(geometry, material); mesh.rotation.set(0.1, 0.35, i === 3 ? -0.3 : 0); if (i === 5) mesh.scale.set(1, 0.55, 0.7); scene.add(mesh);
    renderer.render(scene, camera);
    const blob = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
    files.push(new File([blob], `${String(i + 1).padStart(2, '0')}-${names[i]}.png`, { type: 'image/png' }));
    geometry.dispose(); material.dispose();
  }
  renderer.dispose(); return files;
}
