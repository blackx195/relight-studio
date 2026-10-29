import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lightPosition, clamp } from './core.js';

function placeholderTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#292d31'; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#747c83'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.strokeRect(192, 188, 128, 106); ctx.beginPath(); ctx.arc(226, 218, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(196, 281); ctx.lineTo(238, 245); ctx.lineTo(265, 266); ctx.lineTo(291, 235); ctx.lineTo(316, 257); ctx.stroke();
  ctx.fillStyle = '#9ba2a8'; ctx.textAlign = 'center'; ctx.font = '22px sans-serif'; ctx.fillText('上傳圖片預覽', 256, 344);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class LightScene {
  constructor(container, onChange, onStatus = () => {}) {
    this.container = container; this.onChange = onChange; this.onStatus = onStatus; this.mode = 'image';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x15181b, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    this.camera.position.set(2.6, 1.8, 5.5); this.camera.lookAt(0, 0.15, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    this.bust = new THREE.Group(); this.bust.visible = false; this.scene.add(this.bust);
    this.placeholder = placeholderTexture();
    this.imagePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: this.placeholder, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 }));
    this.imagePlane.scale.set(2.05, 2.05, 1); this.scene.add(this.imagePlane);
    this.imageFrame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.04), new THREE.MeshStandardMaterial({ color: 0x181b1e, roughness: 1 }));
    this.imageFrame.position.z = -0.025; this.imageFrame.scale.set(2.11, 2.11, 1); this.scene.add(this.imageFrame);
    this.loadBust();
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
      this.onChange({ azimuth: Math.round((this.drag.azimuth + (e.clientX - this.drag.x) * 0.7 + 720) % 360), elevation: Math.round(clamp(this.drag.elevation - (e.clientY - this.drag.y) * 0.5, -90, 90)) });
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
  }
  async loadBust() {
    this.bustStatus = '石膏像載入中…'; this.onStatus();
    try {
      const { scene: model } = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/plaster-bust.glb`);
      const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3());
      const scale = 2.4 / box.getSize(new THREE.Vector3()).y;
      model.scale.setScalar(scale); model.position.set(-center.x * scale, -1.02 - box.min.y * scale, -center.z * scale);
      this.bust.add(model); this.bustStatus = ''; this.render();
    } catch { this.bustStatus = '石膏像載入失敗，請重新整理頁面'; }
    this.onStatus();
  }
  setMode(mode) {
    const changed = this.mode !== mode;
    this.mode = mode; this.bust.visible = mode === 'model'; this.imagePlane.visible = this.imageFrame.visible = mode === 'image';
    if (changed && this.lights) this.update(this.lights, this.selected); else this.render();
  }
  async setImage(blob) {
    if (this.imageBlob === blob) return;
    this.imageBlob = blob; const revision = this.imageRevision = (this.imageRevision || 0) + 1;
    this.imageTexture?.dispose(); this.imageTexture = null; this.imagePlane.material.map = this.placeholder;
    this.imagePlane.scale.set(2.05, 2.05, 1); this.imageFrame.scale.set(2.11, 2.11, 1); this.render();
    if (!blob) return;
    const bitmap = await createImageBitmap(blob);
    if (revision !== this.imageRevision) { bitmap.close(); return; }
    // Own a small copy: preview stays valid when an item is regenerated or removed.
    const canvas = document.createElement('canvas'), factor = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#292d31'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    this.imageTexture = new THREE.CanvasTexture(canvas); this.imageTexture.colorSpace = THREE.SRGBColorSpace;
    this.imagePlane.material.map = this.imageTexture; this.imagePlane.material.needsUpdate = true;
    const fit = 2.15 / Math.max(canvas.width, canvas.height), w = canvas.width * fit, h = canvas.height * fit;
    this.imagePlane.scale.set(w, h, 1); this.imageFrame.scale.set(w + 0.06, h + 0.06, 1); this.render();
  }
  resize() { const { width, height } = this.container.getBoundingClientRect(); this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.render(); }
  update(lights, selected) {
    for (const child of [...this.rig.children]) { this.rig.remove(child); child.geometry?.dispose(); child.material?.dispose(); }
    this.lights = lights; this.selected = selected;
    this.current = lights[selected];
    lights.forEach((l, i) => {
      const color = l.type === 'neutral' ? '#ffffff' : l.color;
      const pos = new THREE.Vector3(...lightPosition(l, 2.6));
      // A nearby light produces a visible falloff across the image board.
      // The bust keeps its directional lighting; neither preview submits AI jobs.
      const light = this.mode === 'image'
        ? new THREE.PointLight(color, l.intensity * 4.7, 0, 2)
        : new THREE.DirectionalLight(color, l.intensity * 0.7);
      light.position.copy(pos); this.rig.add(light);
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
  const assets = [
    ['01-j.png', '01-J.png'],
    ['02-salmon.png', '02-鮭魚.png'],
    ['03-q.png', '03-Q.png'],
    ['04-onigiri.png', '04-飯糰.png'],
    ['05-taiyaki.png', '05-鯛魚燒.png'],
    ['06-wild.png', '06-WILD.png'],
  ];
  return Promise.all(assets.map(async ([path, name]) => {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/${path}`);
    if (!response.ok) throw new Error('示範圖片載入失敗，請稍後再試。');
    return new File([await response.blob()], name, { type: 'image/png' });
  }));
}
