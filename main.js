import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPoseClips } from './poses.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0.9, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.85, 0);

// `neal` is a pivot group at his feet; move/spin this for whole-body effects.
const neal = new THREE.Group();
scene.add(neal);

const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

const [gltf, texture] = await Promise.all([
  gltfLoader.loadAsync('assets/neal.glb'),
  new THREE.TextureLoader().loadAsync('assets/scan.webp'),
]);

// The scan has its lighting baked into the texture, so render it unlit.
texture.flipY = false;
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const material = new THREE.MeshBasicMaterial({ map: texture });

const model = gltf.scene;
model.traverse((o) => {
  if (o.isMesh) {
    o.material = material;
    o.frustumCulled = false; // bounds don't follow the skeleton
  }
});
neal.add(model);

// Mixamo bones come through as e.g. "mixamorigLeftArm".
const bones = {};
model.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });

// Hand-made clips (dab, griddy) must be built while the skeleton is
// still in its rest pose, i.e. before the mixer touches it.
const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
Object.assign(clips, buildPoseClips(bones, model));

// --- playback --------------------------------------------------------------

const mixer = new THREE.AnimationMixer(model);
let current = null;
let routine = null; // chained sequence (kickboxing), or null

function play(name, { loop = true, reps = Infinity, fade = 0.25, then = 'idle' } = {}) {
  const action = mixer.clipAction(clips[name]);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, reps);
  action.clampWhenFinished = true;
  if (current && current !== action) action.crossFadeFrom(current, fade, false);
  action.play();
  current = action;
  current.userData = { then: loop && reps === Infinity ? null : then };
}

mixer.addEventListener('finished', (e) => {
  if (e.action !== current) return;
  if (routine) return routine.next();
  const next = current.userData.then;
  if (next) {
    play(next);
    setActive(next);
  }
});

function runRoutine(steps) {
  let i = 0;
  routine = {
    next() {
      const [name, reps = 1] = steps[i++ % steps.length];
      play(name, { loop: true, reps, fade: 0.2 });
    },
  };
  routine.next();
}

const MOVES = [
  { label: 'Idle', run: () => play('idle') },
  { label: 'Wave', run: () => play('wave', { reps: 5 }) },
  { label: 'Dab', run: () => play('dab', { loop: false, fade: 0.12 }) },
  { label: 'Floss', run: () => play('floss', { fade: 0.15 }) },
  { label: 'Griddy', run: () => play('griddy', { fade: 0.15 }) },
  {
    label: 'Kickboxing',
    run: () => runRoutine([
      ['fight_idle', 1], ['jab_cross'], ['fight_idle', 1], ['roundhouse'],
      ['jab_cross'], ['fight_idle', 1], ['high_kick'],
    ]),
  },
  { label: 'Hip Hop', run: () => play('hiphop') },
  { label: 'Samba', run: () => play('samba') },
  { label: 'Chicken', run: () => play('chicken') },
  { label: 'Thriller', run: () => play('thriller') },
  { label: 'Backflip', run: () => play('backflip', { loop: false, fade: 0.15 }) },
];

const panel = document.getElementById('moves');
const setActive = (label) => {
  panel.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.textContent.toLowerCase() === label.toLowerCase()));
};
for (const move of MOVES) {
  const btn = document.createElement('button');
  btn.textContent = move.label;
  btn.onclick = () => {
    routine = null;
    move.run();
    setActive(move.label);
  };
  panel.appendChild(btn);
}
setActive('idle');
play('idle');

document.getElementById('loading').remove();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Hook for extra animation: called every frame with elapsed seconds.
function animate(t) {}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mixer.update(dt);
  animate(clock.elapsedTime);
  controls.update();
  renderer.render(scene, camera);
});

Object.assign(window, { THREE, scene, camera, neal, model, bones, clips, mixer, play });
