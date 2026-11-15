// Emberline: boot and the one loop — a fixed 60 Hz simulation feeding a
// render at the display's rate. The match is a state machine: menu, buy
// phase, live round, round end, match end. One object, G, holds all match
// state; the player, bots, weapons and HUD are the starter's modules.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, createGrenades, WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createSfx } from './sfx.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 115;
const BOMB_SECONDS = 40;
const PLANT_SECONDS = 3;
const WIN_ROUNDS = 8;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const START_MONEY = 800;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const sfx = createSfx();
const hud = createHud();
const weapon = createWeapon(camera);
const grenades = createGrenades(scene, world.colliders, world.shootables);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const shootables = world.shootables;

// Bomb mesh: a small dark box with a blinking amber light, placed on plant.
const bombGroup = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.18, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.5, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombLight.position.y = 0.12;
bombGroup.add(bombBox, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

// Explosion flash for a detonated bomb.
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
blastMesh.visible = false;
scene.add(blastMesh);
let blastLeft = 0;

const G = {
  phase: 'menu',
  phaseTime: 0,
  round: 1,
  roundSite: 'A',
  score: { atk: 0, def: 0 },
  money: START_MONEY,
  health: 100,
  armor: 0,
  alive: true,
  kills: 0,
  deaths: 0,
  owned: { weapons: ['pistol'], grenades: 0, armor: 0 },
  bomb: { state: 'none', site: null, pos: new THREE.Vector3(), timer: 0, beepSecond: -1 },
  plantT: 0,
  buyOpen: false,
  started: false,
  spectate: null,
  prevFiring: false,
  prevGrenade: false,
  prevBuy: false,
  prevKeys: new Set(),
};

const body = player.state;

function damagePlayer(amount) {
  if (!G.alive || G.phase !== 'live') return;
  let rest = amount;
  if (G.armor > 0) {
    const absorbed = Math.min(G.armor, Math.round(amount * 0.5));
    G.armor -= absorbed;
    rest = amount - absorbed;
  }
  G.health -= rest;
  hud.setHealth(G.health, G.armor);
  if (G.health <= 0) {
    G.health = 0;
    G.alive = false;
    G.deaths += 1;
    weapon.refill();
    G.owned = { weapons: ['pistol'], grenades: 0, armor: 0 };
    hud.setWeaponName(WEAPONS.pistol.label);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    const mate = bots.bots.find((b) => b.team === 'atk' && b.alive);
    G.spectate = mate || null;
    hud.showBanner('You are down', mate ? `Spectating ${mate.name}` : 'Your squad is gone');
    sfx.roundLose();
  }
}

const bots = createBots(scene, world.colliders, world.shootables, random, {
  onKill(killer, victim, head) {
    const killerTeam = killer === 'you' || ['Ash', 'Cinder', 'Flint', 'Slate'].includes(killer) ? 'atk' : 'def';
    hud.addKill(killer, victim, killerTeam);
    if (killer === 'you') {
      G.money += KILL_REWARD;
      G.kills += 1;
      hud.setMoney(G.money);
      sfx.kill();
    }
  },
  onDamagePlayer(amount, head, bot) {
    damagePlayer(amount);
  },
  onDefused() {
    if (G.phase === 'live' && G.bomb.state === 'planted') endRound('def', 'Bomb defused');
  },
});

function syncCamera() {
  if (!G.alive && G.spectate) {
    const mate = G.spectate;
    camera.position.set(mate.pos.x, mate.pos.y + 1.5, mate.pos.z);
    camera.rotation.set(0, mate.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function playerChest() {
  return new THREE.Vector3(body.position.x, body.position.y + (body.crouching ? 0.8 : 1.2), body.position.z);
}

function shoot(spread) {
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.5);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : muzzle.clone().addScaledVector(direction, 60);
  bots.fireTracer(muzzle, end);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const head = hit.object.userData.part === 'head';
    const def = weapon.def();
    const killed = bots.damage(bot, head ? def.head : def.damage, null, head);
    hud.hitMarker(killed, 4000);
    sfx.hit();
  }
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  sfx.shot();
  bots.notifyShot(body.position, 'atk', elapsed);
  return true;
}

function throwGrenade() {
  if (G.owned.grenades <= 0) return;
  G.owned.grenades -= 1;
  weapon.state.grenades = 0;
  camera.getWorldDirection(direction);
  grenades.throw(camera.position.clone(), direction.clone());
}

function nearSite() {
  for (const site of Object.values(SITES)) {
    const d = Math.hypot(body.position.x - site.center.x, body.position.z - site.center.z);
    if (d <= site.radius) return site;
  }
  return null;
}

function plantBomb(site) {
  G.bomb.state = 'planted';
  G.bomb.site = site;
  G.bomb.pos.copy(body.position);
  G.bomb.timer = BOMB_SECONDS;
  G.bomb.beepSecond = -1;
  bombGroup.position.copy(body.position);
  bombGroup.visible = true;
  hud.setBombStatus(`BOMB PLANTED AT SITE ${site.id} — ${BOMB_SECONDS}s`, true);
  sfx.plant();
  sendDefenders(site);
}

function sendDefenders(site) {
  const defuser = bots.nearestDefender(site);
  if (defuser) bots.sendToDefuse(defuser, site);
  // A second defender pushes to the site as cover for the defuser.
  const cover = bots.bots
    .filter((b) => b.team === 'def' && b.alive && b !== defuser && !b.defuseTarget)
    .sort((a, b) => {
      const da = Math.hypot(a.pos.x - site.center.x, a.pos.z - site.center.z);
      const db = Math.hypot(b.pos.x - site.center.x, b.pos.z - site.center.z);
      return da - db;
    })[0];
  if (cover) bots.sendToSite(cover, site);
}

function endRound(winner, reason) {
  if (G.phase !== 'live') return;
  G.score[winner] += 1;
  G.money += winner === 'atk' ? WIN_REWARD : LOSS_REWARD;
  hud.setMoney(G.money);
  hud.setScore(G.score.atk, G.score.def);
  const reasons = {
    elim: winner === 'atk' ? 'VEX squad eliminated' : 'Ember squad eliminated',
    bomb: 'Bomb detonated',
    defuse: 'Bomb defused',
    time: 'Time expired — bomb never planted',
  };
  hud.showBanner(winner === 'atk' ? 'ROUND WON' : 'ROUND LOST', reasons[reason] || reason);
  if (winner === 'atk') sfx.roundWin();
  else sfx.roundLose();
  bombGroup.visible = false;
  G.bomb.state = 'none';
  G.phase = 'roundEnd';
  G.phaseTime = 4;
  G.buyOpen = false;
  hud.hideBuy();
  hud.hideProgress();
}

function startRound(n) {
  G.round = n;
  G.roundSite = ['A', 'B', 'mid'][Math.floor(random() * 3)];
  bots.reset(G.roundSite);
  grenades.clear();
  body.position.set(SPAWNS.atk[0][0], 0, SPAWNS.atk[0][1]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  G.health = 100;
  G.alive = true;
  G.spectate = null;
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.plantT = 0;
  bombGroup.visible = false;
  G.phase = 'buy';
  G.phaseTime = BUY_SECONDS;
  G.buyOpen = true;
  hud.setHealth(G.health, G.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(G.money);
  hud.setScore(G.score.atk, G.score.def);
  hud.setBombStatus(`YOU CARRY THE BOMB — PLANT AT SITE ${G.roundSite === 'mid' ? 'A OR B' : G.roundSite}`, false);
  hud.showBuy(G.money, G.owned);
  hud.hideBanner();
  syncCamera();
}

function startMatch() {
  G.score = { atk: 0, def: 0 };
  G.money = START_MONEY;
  G.kills = 0;
  G.deaths = 0;
  G.armor = 0;
  G.owned = { weapons: ['pistol'], grenades: 0, armor: 0 };
  weapon.refill();
  hud.setWeaponName(WEAPONS.pistol.label);
  startRound(1);
}

function endMatch() {
  G.phase = 'matchEnd';
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showOverlay(G.score.atk >= WIN_ROUNDS ? 'matchWin' : 'matchLose', `${G.score.atk}–${G.score.def}`);
}

function buyItem(key) {
  const map = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'sniper', Digit4: 'pistol', KeyG: 'grenade', KeyV: 'armor' };
  const id = map[key];
  if (!id) return;
  if (id === 'grenade') {
    if (G.owned.grenades > 0 || G.money < GRENADE_PRICE) return;
    G.money -= GRENADE_PRICE;
    G.owned.grenades = 1;
    weapon.state.grenades = 1;
  } else if (id === 'armor') {
    if (G.armor > 0 || G.money < ARMOR_PRICE) return;
    G.money -= ARMOR_PRICE;
    G.armor = 50;
    G.owned.armor = 50;
    hud.setHealth(G.health, G.armor);
  } else {
    const def = WEAPONS[id];
    if (G.owned.weapons.includes(id) || G.money < def.price) return;
    G.money -= def.price;
    G.owned.weapons.push(id);
    weapon.buy(id);
    weapon.switchTo(id);
    hud.setWeaponName(def.label);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  }
  hud.setMoney(G.money);
  hud.showBuy(G.money, G.owned);
}

function switchWeapon(key) {
  const order = ['pistol', 'rifle', 'smg', 'sniper'];
  const map = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'sniper', Digit4: 'pistol' };
  const id = map[key];
  if (id && G.owned.weapons.includes(id) && weapon.switchTo(id)) {
    hud.setWeaponName(WEAPONS[id].label);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  } else if (key === 'wheel') {
    const current = order.indexOf(weapon.state.id);
    for (let i = 1; i <= order.length; i += 1) {
      const next = order[(current + i) % order.length];
      if (G.owned.weapons.includes(next)) {
        weapon.switchTo(next);
        hud.setWeaponName(WEAPONS[next].label);
        hud.setAmmo(weapon.state.mag, weapon.state.reserve);
        break;
      }
    }
  }
}

let elapsed = 0;

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;

  if (G.phase === 'buy') {
    G.phaseTime -= dt;
    hud.setTimer(G.phaseTime);
    if (keys.has('KeyB') && !G.prevBuy) {
      G.buyOpen = !G.buyOpen;
      if (G.buyOpen) hud.showBuy(G.money, G.owned);
      else hud.hideBuy();
    }
    G.prevBuy = keys.has('KeyB');
    if (G.buyOpen) {
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyG', 'KeyV']) {
        if (keys.has(code) && !G.prevKeys.has(code)) buyItem(code);
      }
    }
    if (G.phaseTime <= 0) {
      G.phase = 'live';
      G.phaseTime = ROUND_SECONDS;
      G.buyOpen = false;
      hud.hideBuy();
      hud.setBombStatus(`PLANT THE BOMB AT SITE ${G.roundSite === 'mid' ? 'A OR B' : G.roundSite}`, false);
    }
  } else if (G.phase === 'live') {
    G.phaseTime -= dt;
    hud.setTimer(G.phaseTime);

    // Bomb countdown and beeps.
    if (G.bomb.state === 'planted') {
      G.bomb.timer -= dt;
      const whole = Math.ceil(G.bomb.timer);
      if (whole !== G.bomb.beepSecond) {
        G.bomb.beepSecond = whole;
        bombLight.visible = !bombLight.visible;
        if (whole <= 10) sfx.bombBeep();
      }
      hud.setBombStatus(`BOMB PLANTED AT SITE ${G.bomb.site.id} — ${whole}s`, true);
      if (G.bomb.timer <= 0) {
        blastMesh.position.copy(G.bomb.pos).setY(1);
        blastMesh.visible = true;
        blastLeft = 0.5;
        bombGroup.visible = false;
        sfx.explosion();
        endRound('atk', 'bomb');
      }
    }

    // A planted bomb needs a defuser: send the nearest alive defender.
    if (G.bomb.state === 'planted' && !bots.bots.some((b) => b.team === 'def' && b.alive && b.defuseTarget)) {
      sendDefenders(G.bomb.site);
    }

    // Player movement, shooting and actions, only while alive. The look
    // delta is consumed every step so it never piles up while spectating.
    const look = input.takeLook();
    if (G.alive) {
      player.look(look.x, look.y);
      player.step(dt, keys);
      weapon.step(dt);

      // Sniper scope on right mouse.
      const def = weapon.def();
      const aiming = input.state.aiming && def.zoom > 1;
      const targetFov = aiming ? 74 / def.zoom : 74;
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }

      const firing = input.state.firing;
      if (firing && weapon.ready() && (def.auto || !G.prevFiring)) {
        shoot(weapon.spread(player.groundSpeed()) * (aiming ? 0.3 : 1));
      }
      G.prevFiring = firing;
      if (keys.has('KeyR')) weapon.reload();
      if (keys.has('KeyG') && !G.prevGrenade) throwGrenade();
      G.prevGrenade = keys.has('KeyG');
      const wheel = input.takeWheel();
      if (wheel !== 0) switchWeapon('wheel');
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
        if (keys.has(code) && !G.prevKeys.has(code)) switchWeapon(code);
      }

      // Planting: hold E inside a bomb site while carrying the bomb.
      const site = nearSite();
      if (G.bomb.state === 'carried' && site && keys.has('KeyE')) {
        G.plantT += dt;
        hud.showProgress(`PLANTING BOMB — SITE ${site.id}`, G.plantT / PLANT_SECONDS);
        if (G.plantT >= PLANT_SECONDS) {
          hud.hideProgress();
          plantBomb(site);
        }
      } else {
        if (G.plantT > 0) hud.hideProgress();
        G.plantT = 0;
      }
    }

    bots.step(dt, elapsed, {
      pos: body.position, crouching: body.crouching, alive: G.alive,
      speed: player.groundSpeed(), height: body.height,
    });
    bots.updateDefuse(dt);
    grenades.step(dt, (blast) => {
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        blast.check(new THREE.Vector3(bot.pos.x, bot.pos.y + 1.1, bot.pos.z), false, bot);
      }
      blast.check(playerChest(), true, null);
      for (const hit of blast.hits) {
        if (hit.isPlayer) damagePlayer(hit.amount);
        else bots.damage(hit.target, hit.amount, null, false);
      }
      sfx.explosion();
    });

    // Round end by elimination or by the clock.
    if (G.phase === 'live') {
      if (G.bomb.state !== 'planted') {
        if (bots.aliveCount('def') === 0) endRound('atk', 'elim');
        else if (bots.aliveCount('atk') === 0 && !G.alive) endRound('def', 'elim');
        else if (G.phaseTime <= 0) endRound('def', 'time');
      } else if (bots.aliveCount('def') === 0 && !bots.bots.some((b) => b.team === 'def' && b.alive)) {
        // Bomb planted and every defender is down: it will detonate.
      }
    }
  } else if (G.phase === 'roundEnd') {
    G.phaseTime -= dt;
    hud.setTimer(0);
    if (G.phaseTime <= 0) {
      if (G.score.atk >= WIN_ROUNDS || G.score.def >= WIN_ROUNDS) endMatch();
      else startRound(G.round + 1);
    }
  }

  if (blastLeft > 0) {
    blastLeft -= dt;
    const k = Math.max(0, blastLeft / 0.5);
    blastMesh.scale.setScalar(1 + (1 - k) * 8);
    blastMesh.material.opacity = k * 0.6;
    if (blastLeft <= 0) blastMesh.visible = false;
  }

  G.prevKeys = new Set(keys);
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (G.phase === 'live' || G.phase === 'buy' || G.phase === 'roundEnd') {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  G.started = true;
  if (name === 'start') {
    // Spawn view down mid with the buy menu open and teammates beside.
    body.position.set(0, 0, 15);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    hud.showBuy(G.money, G.owned);
    aimAt(new THREE.Vector3(0, 1.5, -6));
  } else if (name === 'play') {
    // Mid-round firefight, staged at the Site A entrance: the defenders
    // hold inside the site and the player pushes in with the team.
    G.phase = 'live';
    G.phaseTime = ROUND_SECONDS - 20;
    G.buyOpen = false;
    hud.hideBuy();
    body.position.set(-10, 0, -3);
    body.yaw = 0.93;
    body.pitch = 0;
    settle(60 * 3);
    // Aim at the nearest defender with a clear line of sight, so the
    // scripted shots land on a bot instead of a wall.
    let target = null;
    let targetDist = Infinity;
    for (const bot of bots.bots) {
      if (bot.team !== 'def' || !bot.alive) continue;
      const point = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.1, bot.pos.z);
      const dist = body.position.distanceTo(point);
      if (dist >= targetDist) continue;
      direction.copy(point).sub(camera.position).normalize();
      raycaster.set(camera.position, direction);
      raycaster.far = dist;
      if (raycaster.intersectObjects(shootables, false).length) continue;
      target = bot;
      targetDist = dist;
    }
    if (target) {
      aimAt(new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z));
      for (let round = 0; round < 3; round += 1) {
        shoot(0);
        settle(8);
      }
    }
    settle(12);
  } else {
    // Round won: banner up, defenders down, player at Site A by the bomb.
    G.phase = 'live';
    G.phaseTime = ROUND_SECONDS - 40;
    G.buyOpen = false;
    hud.hideBuy();
    G.score.atk = 1;
    hud.setScore(1, 0);
    body.position.set(-14, 0, -5);
    settle(30);
    for (const bot of bots.bots) {
      if (bot.team === 'def' && bot.alive) bots.damage(bot, 200, null, false);
    }
    G.bomb.state = 'planted';
    G.bomb.site = SITES.A;
    G.bomb.pos.set(-18, 0, -9);
    G.bomb.timer = 32;
    bombGroup.position.copy(G.bomb.pos);
    bombGroup.visible = true;
    hud.setBombStatus('BOMB PLANTED AT SITE A — 32s', true);
    hud.showBanner('ROUND WON', 'Site A secured — bomb detonated');
    aimAt(new THREE.Vector3(-18, 1.2, -9));
    settle(20);
  }
  hud.setScore(G.score.atk, G.score.def);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(G.money);
  hud.setHealth(G.health, G.armor);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();

hud.setAmmo(weapon.state.mag, weapon.state.reserve);
hud.setMoney(G.money);
hud.setHealth(G.health, G.armor);
hud.setScore(0, 0);
hud.setTimer(ROUND_SECONDS);
hud.onPlay(() => {
  sfx.unlock();
  if (shot) return;
  if (G.phase === 'matchEnd' || G.phase === 'menu') {
    startMatch();
    G.started = true;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (G.phase === 'live' || G.phase === 'buy') {
    hud.showOverlay('paused');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);

// Debug handle for local playtesting: lets a test read match state and bot
// positions, and advance the fixed-step simulation deterministically (the
// headless software renderer runs far below 60 fps, so the live loop would
// otherwise run in slow motion). It changes nothing about the game itself.
window.__emberline = {
  G, bots, player, weapon,
  advance(seconds) {
    const n = Math.round(seconds / FIXED_STEP);
    for (let i = 0; i < n; i += 1) step(FIXED_STEP);
  },
};
