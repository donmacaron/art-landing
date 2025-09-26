// src/scene.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GUI from 'lil-gui';

let renderer, scene, camera, animationId;
let paramsLocal = null;

/**
 * initScene(params) - sets up Three.js scene, loads model, returns a Promise
 * that resolves when all assets (via LoadingManager) are loaded.
 */
export function initScene(params) {
  paramsLocal = params;
  return new Promise((resolve, reject) => {
    try {
      // create canvas and renderer
      const canvas = document.createElement('canvas');
      canvas.id = 'three-canvas';
      document.body.appendChild(canvas);

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // scene + fog
      scene = new THREE.Scene();
      scene.background = new THREE.Color(params.sceneBg);
      scene.fog = new THREE.Fog(params.fogColor, params.fogNear, params.fogFar);

      // orthographic camera factory
      function makeOrthoCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        const fs = params.frustumSize;
        camera = new THREE.OrthographicCamera(-fs * aspect, fs * aspect, fs, -fs, 0.1, 100);
        camera.position.set(params.cameraStart.x, params.cameraStart.y, params.cameraStart.z);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
      }
      makeOrthoCamera();

      // lights
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
      dirLight.position.set(-4, 6, 4);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(2048, 2048);
      dirLight.shadow.camera.left = -6;
      dirLight.shadow.camera.right = 6;
      dirLight.shadow.camera.top = 6;
      dirLight.shadow.camera.bottom = -6;
      scene.add(dirLight);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.4));

      // ground plane
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0xE9E6E4, roughness: 1 })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = -1.2;
      plane.receiveShadow = true;
      scene.add(plane);

      // fog markers (green = near, red = far)
      const fogStartSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
      );
      fogStartSphere.name = 'fogStartSphere';
      fogStartSphere.position.z = -params.fogNear;
      scene.add(fogStartSphere);

      const fogEndSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      fogEndSphere.name = 'fogEndSphere';
      fogEndSphere.position.z = -params.fogFar;
      scene.add(fogEndSphere);

      // loading manager for GLTF
      const loadingManager = new THREE.LoadingManager();
      loadingManager.onStart = (url) => console.log('Start loading', url);
      loadingManager.onProgress = (url, loaded, total) => console.log(`Loading: ${loaded}/${total}`, url);
      loadingManager.onError = (url) => console.warn('Error loading', url);

      // when all assets loaded, resolve the promise
      loadingManager.onLoad = function () {
        console.log('Three.js loading complete.');
        // start the render loop
        startLoop();
        resolve();
      };

      // GLTF loader
      const gltfLoader = new GLTFLoader(loadingManager);

      // model recolor helper
      function recolorMaterial(mat) {
        try {
          if (mat.map) mat.map = null;
          if (mat.color) mat.color.set(params.modelColor);
          mat.needsUpdate = true;
        } catch (e) {}
      }

      // load model
      gltfLoader.load(
        params.modelPath,
        (gltf) => {
          const originalModel = gltf.scene;
          originalModel.visible = true;

          originalModel.traverse((node) => {
            if (node.isMesh) {
              if (Array.isArray(node.material)) {
                node.material.forEach(recolorMaterial);
              } else {
                recolorMaterial(node.material);
              }
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });

          originalModel.position.set(0, -1.19, 0);
          originalModel.scale.setScalar(1.0);
          scene.add(originalModel);
        },
        undefined,
        (err) => {
          console.error('GLTF load error', err);
        }
      );

      // GUI
      const gui = new GUI({ width: 300 });
      const fogFolder = gui.addFolder('Fog');
      fogFolder.addColor(params, 'fogColor').onChange((v) => {
        scene.fog.color.set(v);
        scene.background.set(v);
      });
      fogFolder.add(params, 'fogNear', 0.1, 20).onChange((v) => {
        scene.fog.near = v;
        const s = scene.getObjectByName('fogStartSphere');
        if (s) s.position.z = -v;
      });
      fogFolder.add(params, 'fogFar', 1, 50).onChange((v) => {
        scene.fog.far = v;
        const s = scene.getObjectByName('fogEndSphere');
        if (s) s.position.z = -v;
      });
      fogFolder.open();

      const camFolder = gui.addFolder('Camera');
      camFolder.add(params.cameraStart, 'x', -10, 10).onChange((v) => {
        camera.position.x = v;
      });
      camFolder.add(params.cameraStart, 'y', -10, 10).onChange((v) => {
        camera.position.y = v;
      });
      camFolder.add(params.cameraStart, 'z', -10, 20).onChange((v) => {
        camera.position.z = v;
      });
      camFolder.add(params, 'frustumSize', 0.5, 10).onChange(() => {
        // rebuild orthographic projection
        const aspect = window.innerWidth / window.innerHeight;
        const fs = params.frustumSize;
        camera.left = -fs * aspect;
        camera.right = fs * aspect;
        camera.top = fs;
        camera.bottom = -fs;
        camera.updateProjectionMatrix();
      });
      camFolder.open();

      // resize
      window.addEventListener('resize', onWindowResize);

      function onWindowResize() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        const aspect = window.innerWidth / window.innerHeight;
        const fs = params.frustumSize;
        if (camera && camera.isOrthographicCamera) {
          camera.left = -fs * aspect;
          camera.right = fs * aspect;
          camera.top = fs;
          camera.bottom = -fs;
          camera.updateProjectionMatrix();
        } else if (camera) {
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
        }
      }

      // render loop
      function startLoop() {
        if (animationId) cancelAnimationFrame(animationId);
        function _frame() {
          renderer.render(scene, camera);
          animationId = requestAnimationFrame(_frame);
        }
        _frame();
      }

      // expose a simple dispose function if needed later
      // window.__threeDispose = () => { ... }

    } catch (err) {
      reject(err);
    }
  });
}
