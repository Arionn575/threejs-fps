// Weapons: one table owns every number, so the buy menu, the HUD and the
// gun all read the same stats. Four guns plus a grenade. Each gun has a
// box-built view model, a magazine, a reload, and spread that punishes
// firing on the move. The grenade is a small physics object: it arcs,
// bounces once or twice, then bursts after a 1.5 s fuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { label: 'P9 Sidearm', price: 0, mag: 12, reserve: 48, gap: 0.18, reload: 1.2, damage: 20, head: 60, spreadStill: 0.004, spreadMove: 0.03, auto: false, zoom: 1 },
  rifle: { label: 'AR-7 Carbine', price: 2700, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, damage: 34, head: 100, spreadStill: 0.0022, spreadMove: 0.028, auto: true, zoom: 1 },
  smg: { label: 'VK-9 Striker', price: 1500, mag: 25, reserve: 100, gap: 0.06, reload: 1.6, damage: 25, head: 75, spreadStill: 0.006, spreadMove: 0.04, auto: true, zoom: 1 },
  sniper: { label: 'LR-50 Longshot', price: 4750, mag: 5, reserve: 15, gap: 1.1, reload: 2.8, damage: 90, head: 150, spreadStill: 0.0005, spreadMove: 0.05, auto: false, zoom: 2.4 },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.2 });

  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  function buildModel(id) {
    const model = new THREE.Group();
    if (id === 'pistol') {
      model.add(part(0.07, 0.1, 0.3, 0, 0, -0.12, body));
      model.add(part(0.06, 0.045, 0.2, 0, 0.07, -0.1, dark));
      model.add(part(0.06, 0.14, 0.09, 0, -0.1, 0.05, grip));
    } else if (id === 'rifle') {
      model.add(part(0.09, 0.1, 0.42, 0, 0, 0, body));
      model.add(part(0.045, 0.045, 0.4, 0, 0.025, -0.38, grip));
      model.add(part(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip));
    } else if (id === 'smg') {
      model.add(part(0.08, 0.09, 0.34, 0, 0, 0, body));
      model.add(part(0.04, 0.04, 0.34, 0, 0.02, -0.32, dark));
      model.add(part(0.05, 0.16, 0.06, 0, -0.1, -0.02, grip));
    } else {
      model.add(part(0.07, 0.09, 0.5, 0, 0, -0.05, body));
      model.add(part(0.03, 0.03, 0.62, 0, 0.03, -0.45, dark));
      model.add(part(0.06, 0.07, 0.16, 0, 0.09, -0.05, dark));
      model.add(part(0.07, 0.1, 0.2, 0, -0.02, 0.28, grip));
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const id of Object.keys(WEAPONS)) models[id] = buildModel(id);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const [id, def] of Object.entries(WEAPONS)) ammo[id] = { mag: def.mag, reserve: def.reserve };
  const state = { id: 'pistol', mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve, grenades: 0, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  models.pistol.visible = true;

  function sync() {
    state.mag = ammo[state.id].mag;
    state.reserve = ammo[state.id].reserve;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.id];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (WEAPONS[state.id].reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const def = WEAPONS[state.id];
        const take = Math.min(def.mag - ammo[state.id].mag, ammo[state.id].reserve);
        ammo[state.id].mag += take;
        ammo[state.id].reserve -= take;
        sync();
      }
    }
  }

  return {
    state,
    step,
    def() {
      return WEAPONS[state.id];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.id].gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      ammo[state.id].mag -= 1;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (state.reloadLeft > 0 || ammo[state.id].mag === def.mag || ammo[state.id].reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      const def = WEAPONS[state.id];
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === state.id || state.reloadLeft > 0) return false;
      models[state.id].visible = false;
      state.id = id;
      models[id].visible = true;
      state.cooldown = 0.25;
      sync();
      return true;
    },
    buy(id) {
      const def = WEAPONS[id];
      if (!def) return false;
      ammo[id] = { mag: def.mag, reserve: def.reserve };
      return true;
    },
    refill() {
      for (const [id, def] of Object.entries(WEAPONS)) ammo[id] = { mag: def.mag, reserve: def.reserve };
      state.id = 'pistol';
      for (const [id, model] of Object.entries(models)) model.visible = id === 'pistol';
      state.grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      sync();
    },
  };
}

// Grenades: thrown, they arc and bounce, then burst after a 1.5 s fuse.
// Damage falls off with distance and is blocked by walls.
export function createGrenades(scene, colliders, shootables) {
  const raycaster = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const live = [];
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.4, metalness: 0.6 });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.visible = false;
  scene.add(flashMesh);
  let flashLeft = 0;

  function explode(grenade) {
    const pos = grenade.pos;
    flashMesh.position.copy(pos);
    flashMesh.visible = true;
    flashLeft = 0.25;
    const hits = [];
    const check = (point, isPlayer, target) => {
      const dist = pos.distanceTo(point);
      if (dist > 5) return;
      from.copy(pos);
      dir.copy(point).sub(pos).normalize();
      raycaster.set(from, dir);
      raycaster.far = dist;
      if (raycaster.intersectObjects(shootables, false).length) return;
      hits.push({ target, isPlayer, amount: Math.max(10, Math.round(90 * (1 - dist / 5))) });
    };
    return { pos: pos.clone(), check, hits };
  }

  return {
    throw(origin, direction) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      scene.add(mesh);
      live.push({
        mesh, pos: origin.clone(),
        vel: direction.clone().multiplyScalar(14).add(new THREE.Vector3(0, 3.5, 0)),
        fuse: 1.5,
      });
    },
    step(dt, onExplode) {
      if (flashLeft > 0) {
        flashLeft -= dt;
        const k = Math.max(0, flashLeft / 0.25);
        flashMesh.scale.setScalar(1 + (1 - k) * 4);
        flashMat.opacity = k * 0.7;
        if (flashLeft <= 0) flashMesh.visible = false;
      }
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const g = live[i];
        g.fuse -= dt;
        g.vel.y -= 12 * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y < 0.09) {
          g.pos.y = 0.09;
          g.vel.y = Math.abs(g.vel.y) * 0.4;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        for (const box of colliders) {
          if (g.pos.x > box.min.x - 0.09 && g.pos.x < box.max.x + 0.09
            && g.pos.y > box.min.y - 0.09 && g.pos.y < box.max.y + 0.09
            && g.pos.z > box.min.z - 0.09 && g.pos.z < box.max.z + 0.09) {
            // Push out along the smallest penetration and reflect.
            const dxMin = g.pos.x - (box.min.x - 0.09);
            const dxMax = (box.max.x + 0.09) - g.pos.x;
            const dzMin = g.pos.z - (box.min.z - 0.09);
            const dzMax = (box.max.z + 0.09) - g.pos.z;
            const m = Math.min(dxMin, dxMax, dzMin, dzMax);
            if (m === dxMin || m === dxMax) {
              g.pos.x = m === dxMin ? box.min.x - 0.09 : box.max.x + 0.09;
              g.vel.x *= -0.4;
            } else {
              g.pos.z = m === dzMin ? box.min.z - 0.09 : box.max.z + 0.09;
              g.vel.z *= -0.4;
            }
          }
        }
        g.mesh.position.copy(g.pos);
        if (g.fuse <= 0) {
          const blast = explode(g);
          scene.remove(g.mesh);
          live.splice(i, 1);
          onExplode(blast);
        }
      }
    },
    clear() {
      for (const g of live) scene.remove(g.mesh);
      live.length = 0;
      flashMesh.visible = false;
      flashLeft = 0;
    },
  };
}
