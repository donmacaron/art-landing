import * as THREE from 'three';
import './style.css';

// создаём canvas и WebGLRenderer (вставляем canvas в body)
const canvas = document.createElement('canvas');
canvas.id = 'three-canvas';
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e0e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 3;

const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(5, 10, 7);
scene.add(light);

const ambient = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambient);

const geometry = new THREE.BoxGeometry(1,1,1);
const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Handle resize
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();

// Test API call — this will be proxied to Flask (http://localhost:5000/api/hello)
fetch('/api/hello')
  .then(r => r.json())
  .then(j => {
    console.log('API response:', j);
    const el = document.createElement('div');
    el.textContent = j.msg;
    el.style.position = 'fixed';
    el.style.left = '20px';
    el.style.top = '80px';
    el.style.color = '#fff';
    el.style.zIndex = 30;
    document.body.appendChild(el);
  })
  .catch(err => console.error('API error:', err));
