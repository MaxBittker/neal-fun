import * as THREE from 'three';

// Hand-authored dances for moves Mixamo doesn't have (dab, griddy).
//
// A pose maps bone names (Mixamo names minus the "mixamorig" prefix) to:
//   aim: [x, y, z]  point the bone toward this direction
//   rot: [x, y, z]  extra rotation in degrees about those axes
// plus an optional `hips: [x, y, z]` offset in meters. Directions are in
// Neal's body frame: +x = his left, +y = up, +z = the way he's facing.
// Bones are posed parent-first, so a forearm's aim is absolute, not relative
// to the upper arm. Anything a pose leaves out stays in the T-pose rest.

const STAND = {
  LeftArm: { aim: [0.25, -1, 0.05] },
  LeftForeArm: { aim: [0.15, -1, 0.25] },
  RightArm: { aim: [-0.25, -1, 0.05] },
  RightForeArm: { aim: [-0.15, -1, 0.25] },
};

const DAB = {
  // Straight arm out to his upper left...
  LeftArm: { aim: [1, 0.55, 0.25] },
  LeftForeArm: { aim: [1, 0.6, 0.25] },
  // ...the other arm folded across his face, pointing the same way...
  RightArm: { aim: [0.55, 0.45, 0.7] },
  RightForeArm: { aim: [0.75, 0.6, -0.1] },
  // ...and his face buried in that elbow.
  Spine2: { rot: [0, 0, 8] },
  Neck: { rot: [15, 10, 0] },
  Head: { rot: [35, 25, 0] },
};

// Griddy: alternate a high knee with a forward heel tap, arms pumping
// opposite the legs, leaning into it.
const GRIDDY_KNEE = {
  hips: [0, -0.02, 0],
  Spine: { rot: [14, 0, 0] },
  Head: { rot: [-12, 0, 0] },
  LeftUpLeg: { aim: [0.05, -0.45, 0.9] },
  LeftLeg: { aim: [0, -1, -0.1] },
  RightUpLeg: { aim: [0, -1, 0.05] },
  RightLeg: { aim: [0, -1, -0.05] },
  RightArm: { aim: [-0.15, -0.75, 0.6] },
  RightForeArm: { aim: [-0.05, 0.3, 0.95] },
  LeftArm: { aim: [0.2, -0.75, -0.6] },
  LeftForeArm: { aim: [0.1, -0.9, -0.35] },
};
const GRIDDY_TAP = {
  hips: [0, -0.06, 0],
  Spine: { rot: [10, 0, 0] },
  Head: { rot: [-10, 0, 0] },
  LeftUpLeg: { aim: [0.05, -0.9, 0.4] },
  LeftLeg: { aim: [0.02, -0.85, 0.5] },
  LeftFoot: { rot: [-20, 0, 0] },
  RightUpLeg: { aim: [0, -1, 0.15] },
  RightLeg: { aim: [0, -1, -0.15] },
  RightArm: { aim: [-0.15, -0.85, 0.45] },
  RightForeArm: { aim: [-0.05, 0.1, 1] },
  LeftArm: { aim: [0.2, -0.85, -0.45] },
  LeftForeArm: { aim: [0.1, -0.95, -0.1] },
};

// Mirror a pose left <-> right.
function mirror(pose) {
  const out = {};
  for (const [key, spec] of Object.entries(pose)) {
    if (key === 'hips') { out.hips = [-spec[0], spec[1], spec[2]]; continue; }
    const name = key.replace(/^Left|^Right/, (s) => (s === 'Left' ? 'Right' : 'Left'));
    out[name] = {};
    if (spec.aim) out[name].aim = [-spec.aim[0], spec.aim[1], spec.aim[2]];
    if (spec.rot) out[name].rot = [spec.rot[0], -spec.rot[1], -spec.rot[2]];
  }
  return out;
}

// Each clip: [time in seconds, pose] keyframes. Loops should end on their
// first pose.
const CLIPS = {
  dab: [[0, DAB], [1.4, DAB], [1.6, STAND]],
  griddy: [
    [0, GRIDDY_KNEE], [0.2, GRIDDY_TAP],
    [0.4, mirror(GRIDDY_KNEE)], [0.6, mirror(GRIDDY_TAP)],
    [0.8, GRIDDY_KNEE],
  ],
};

export function buildPoseClips(bones, root) {
  root.updateMatrixWorld(true);
  const list = Object.values(bones); // traversal order: parents first
  const rest = new Map(list.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));

  // Work out which world axes are his left/forward from the rest skeleton.
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const left = wp(bones.LeftArm).sub(wp(bones.RightArm)).setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3().crossVectors(left, up);
  const toWorld = ([x, y, z]) => new THREE.Vector3()
    .addScaledVector(left, x).addScaledVector(up, y).addScaledVector(forward, z).normalize();

  const pq = new THREE.Quaternion();
  const rotateInWorld = (bone, R) => {
    // Apply world-space rotation R to the bone: L' = P^-1 * R * P * L
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.premultiply(pq).premultiply(R).premultiply(pq.invert());
    bone.updateMatrixWorld(true);
  };

  function solve(pose) {
    for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); }
    root.updateMatrixWorld(true);

    if (pose.hips) {
      const hips = bones.Hips;
      const offset = new THREE.Vector3()
        .addScaledVector(left, pose.hips[0]).addScaledVector(up, pose.hips[1]).addScaledVector(forward, pose.hips[2]);
      const parentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const parentS = hips.parent.getWorldScale(new THREE.Vector3());
      offset.applyQuaternion(parentQ).divide(parentS);
      hips.position.add(offset);
      root.updateMatrixWorld(true);
    }

    for (const bone of list) {
      const name = bone.name.replace(/^mixamorig:?/, '');
      const spec = pose[name];
      if (!spec) continue;
      if (spec.aim) {
        const child = bone.children.find((c) => c.isBone);
        const cur = wp(child).sub(wp(bone)).normalize();
        rotateInWorld(bone, new THREE.Quaternion().setFromUnitVectors(cur, toWorld(spec.aim)));
      }
      if (spec.rot) {
        const [x, y, z] = spec.rot.map(THREE.MathUtils.degToRad);
        const R = new THREE.Quaternion().setFromAxisAngle(up, y)
          .multiply(new THREE.Quaternion().setFromAxisAngle(left, x))
          .multiply(new THREE.Quaternion().setFromAxisAngle(forward, z));
        rotateInWorld(bone, R);
      }
    }
    return {
      quats: list.map((b) => b.quaternion.clone()),
      hips: bones.Hips.position.clone(),
    };
  }

  const clips = {};
  for (const [name, keys] of Object.entries(CLIPS)) {
    const times = keys.map(([t]) => t);
    const solved = keys.map(([, pose]) => solve(pose));
    const tracks = list.map((b, i) => new THREE.QuaternionKeyframeTrack(
      `${b.name}.quaternion`, times, solved.flatMap((s) => s.quats[i].toArray()),
    ));
    tracks.push(new THREE.VectorKeyframeTrack(
      `${bones.Hips.name}.position`, times, solved.flatMap((s) => s.hips.toArray()),
    ));
    clips[name] = new THREE.AnimationClip(name, -1, tracks);
  }

  for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); }
  root.updateMatrixWorld(true);
  return clips;
}
