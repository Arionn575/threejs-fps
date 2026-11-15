// Emberline: an original desert-industrial yard, 48 x 36 m. Attackers spawn
// south, defenders north. Two bomb sites (A west warehouse, B east crate
// yard), three north-south lanes (A, mid, B) joined by a south connector and
// a top connector, with crates, pillars and walls for cover and corners.
// Every box is a collider for movement and a surface a bullet stops on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { id: 'A', center: new THREE.Vector3(-18, 0, -9), radius: 5 },
  B: { id: 'B', center: new THREE.Vector3(18, 0, -9), radius: 5 },
};

// Attacker spawn points (player first), defender spawn points.
export const SPAWNS = {
  atk: [[0, 15], [-4, 15], [4, 15], [-2, 16.5], [2, 16.5]],
  def: [[-4, -14], [4, -14], [-2, -15.5], [2, -15.5], [0, -13]],
};

// Waypoint routes (x, z) bots follow. Attackers advance toward a site;
// defenders walk to a hold point and watch.
export const ROUTES = {
  atkA: [[-2, 12], [-12, 10], [-14, 4], [-14, -2], [-16, -6], [-18, -9]],
  atkB: [[2, 12], [12, 10], [14, 4], [14, -2], [16, -6], [18, -9]],
  atkMid: [[0, 10], [0, 4], [4.5, 1], [4.5, -3], [0, -6]],
  midToA: [[-4, -4], [-10, -4], [-14, -4], [-18, -8]],
  midToB: [[4, -4], [10, -4], [14, -4], [18, -8]],
  holdA: [[-19, -13], [-15, -12], [-20, -7], [-12, -8]],
  holdB: [[19, -13], [15, -12], [20, -7], [12, -8]],
  holdMid: [[-3, -13], [3, -13], [0, -15]],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and outer walls, 48 x 36 m, 5 m high, open to a dusk sky.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, 'ground');
  box(0.4, 5, 36.4, -24.2, 2.5, 0, 'surface');
  box(0.4, 5, 36.4, 24.2, 2.5, 0, 'surface');
  box(48.4, 5, 0.4, 0, 2.5, -18.2, 'surface');
  box(48.4, 5, 0.4, 0, 2.5, 18.2, 'surface');

  // Lane dividers: two walls each, with a top-connector gap at z in [-6, -2]
  // so mid can rotate to A or B, and defenders can rotate between sites.
  box(0.4, 5, 12, -7, 2.5, -12, 'surface');
  box(0.4, 5, 8, -7, 2.5, 2, 'surface');
  box(0.4, 5, 12, 7, 2.5, -12, 'surface');
  box(0.4, 5, 8, 7, 2.5, 2, 'surface');

  // Site south walls, with one entrance gap each where the lane comes in.
  box(12, 4, 0.4, -18, 2, -2, 'surface');
  box(12, 4, 0.4, 18, 2, -2, 'surface');

  // Site A: warehouse platform, crates, a tall stack, a pillar.
  box(6, 0.5, 4, -19, 0.25, -12, 'hairline');
  box(1.6, 1.1, 1.6, -21, 0.55, -14, 'rust');
  box(1.2, 1.1, 1.2, -16, 0.55, -14, 'sand');
  box(2.4, 2.2, 1.2, -20, 1.1, -6, 'rust');
  box(1.2, 3.2, 1.2, -12, 1.6, -8, 'hairline');

  // Site B: crate yard, stacks and a pillar.
  box(1.6, 1.1, 1.6, 20, 0.55, -14, 'sand');
  box(1.2, 1.1, 1.2, 16, 0.55, -12, 'rust');
  box(2, 2.2, 1.2, 21, 1.1, -7, 'rust');
  box(1.6, 1.1, 1.6, 13, 0.55, -15, 'sand');
  box(1.2, 3.2, 1.2, 12, 1.6, -8, 'hairline');

  // Lane cover: corner walls, crates and pillars along A, B and mid.
  box(6, 3, 0.4, -21, 1.5, 2, 'surface');
  box(6, 3, 0.4, 21, 1.5, 2, 'surface');
  box(2, 1.1, 1.2, -14, 0.55, 6, 'rust');
  box(2, 1.1, 1.2, 14, 0.55, 6, 'sand');
  box(1.2, 3.2, 1.2, -18, 1.6, -2, 'hairline');
  box(1.2, 3.2, 1.2, 18, 1.6, -2, 'hairline');
  box(1.2, 1.1, 1.2, -10, 0.55, -4, 'sand');
  box(1.2, 1.1, 1.2, 10, 0.55, -4, 'rust');
  box(1.2, 3.2, 1.2, 3.5, 1.6, -2, 'hairline');
  box(1.6, 1.1, 1.6, -3, 0.55, 3, 'rust');
  box(8, 1.2, 0.4, 0, 0.6, -7, 'hairline');
  // Mid door: a wall across mid with the gap on the east side, so no lane
  // has a spawn-to-spawn sightline and every push has a corner to peek.
  box(9, 3.4, 0.4, -2.5, 1.7, 0, 'surface');

  // South connector cover near the attacker spawn.
  box(2.4, 1.1, 1.2, 0, 0.55, 12, 'sand');
  box(1.6, 1.1, 1.6, -10, 0.55, 10, 'rust');
  box(1.6, 1.1, 1.6, 10, 0.55, 10, 'sand');

  // Bomb-site pads and letter signs (canvas textures, drawn locally).
  for (const site of Object.values(SITES)) {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.06, 7),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.8 }),
    );
    pad.position.set(site.center.x, 0.03, site.center.z);
    pad.receiveShadow = true;
    group.add(pad);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2e2a26';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 190px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(site.id, 128, 136);
    const texture = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    sign.position.set(site.center.x, 3.2, -17.9);
    group.add(sign);
  }

  // Light: a low amber sun from the west, a cool fill, and a dusk gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sand), new THREE.Color(PALETTE.ground), 0.9);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.4);
  key.position.set(-14, 16, 6);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.defender), 0.5);
  fill.position.set(10, 9, 12);
  scene.add(fill);

  return { colliders, shootables, group };
}
