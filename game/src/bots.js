// Bots: 5v5, player + 4 amber teammates vs 5 blue defenders. Each bot is a
// box-built figure with a torso and a head hitbox, walks a seeded waypoint
// route along a lane, holds a position, and engages what it can see: a
// line-of-sight raycast, a reaction delay, burst fire with spread, reloads,
// and a retreat when hurt. One defender walks to a planted bomb and defuses.
// Bot shots are real hitscan: a ray against the target's hitboxes, blocked
// by walls first. No new objects are made in the hot loop: raycasters,
// vectors and the tracer pool are preallocated.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ROUTES, SPAWNS, SITES } from './world.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.5;
const SPEED = 3.4;
const MAG = 30;
const FIRE_GAP = 0.12;
const RELOAD_TIME = 1.9;
const BOT_DAMAGE_BODY = 20;
const BOT_DAMAGE_HEAD = 60;

const TEAMMATES = ['Ash', 'Cinder', 'Flint', 'Slate'];
const ENEMIES = ['Rook', 'Hawk', 'Onyx', 'Blaze', 'Frost'];

// Slab-method ray vs axis-aligned box; returns the hit distance or Infinity.
function rayAABB(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min[axis] || o > max[axis]) return Infinity;
    } else {
      let t1 = (min[axis] - o) / d;
      let t2 = (max[axis] - o) / d;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function createBots(scene, colliders, shootables, random, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();
  const tmpMin = new THREE.Vector3();
  const tmpMax = new THREE.Vector3();

  const teamMat = {
    atk: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.attacker), roughness: 0.6, metalness: 0.05 }),
    def: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.defender), roughness: 0.6, metalness: 0.05 }),
  };
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const flashGeo = new THREE.PlaneGeometry(0.34, 0.34);
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });

  // Tracer pool: 16 preallocated streaks, reused, never allocated in play.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 16; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  function fireTracer(from, to) {
    const tracer = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const length = from.distanceTo(to);
    if (length < 0.1) return;
    tracer.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    tracer.mesh.lookAt(to);
    tracer.mesh.scale.set(1, 1, length);
    tracer.mesh.visible = true;
    tracer.life = 0.08;
  }

  const bots = [];
  const hitMeshes = [];

  function makeBot(team, name, spawn, index) {
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.11, 0.25, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.11, 0.25, 0);
    const torso = new THREE.Mesh(torsoGeo, teamMat[team]);
    torso.position.y = 0.86;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.44;
    head.userData.part = 'head';
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.2, 1.15, -0.3);
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0.2, 1.15, -0.62);
    flash.visible = false;
    group.add(legL, legR, torso, head, gun, flash);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);

    const bot = {
      team, name, group, torso, head, flash, index,
      pos: group.position,
      yaw: team === 'atk' ? 0 : Math.PI,
      vel: new THREE.Vector3(),
      health: 100, alive: true,
      state: 'advance', route: [], waypoint: 0, hold: null, holdYaw: 0,
      skill: 0.55 + random() * 0.4,
      reaction: 0.35 + random() * 0.3,
      target: null, targetIsPlayer: false, seenAt: -10, reactAt: 0,
      burst: 0, burstPause: 0, cooldown: 0, mag: MAG, reloadLeft: 0,
      flashLeft: 0, fall: 0, phase: random() * 6.28, heard: null, defuseT: 0,
      strafeDir: random() > 0.5 ? 1 : -1,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('atk', TEAMMATES[i], SPAWNS.atk[i + 1], i);
  for (let i = 0; i < 5; i += 1) makeBot('def', ENEMIES[i], SPAWNS.def[i], i);

  function overlaps(x, z) {
    probe.min.set(x - RADIUS, 0.04, z - RADIUS);
    probe.max.set(x + RADIUS, 1.7, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveBot(bot, dt) {
    const nextX = bot.pos.x + bot.vel.x * dt;
    if (!overlaps(nextX, bot.pos.z)) bot.pos.x = nextX;
    else bot.vel.x = 0;
    const nextZ = bot.pos.z + bot.vel.z * dt;
    if (!overlaps(bot.pos.x, nextZ)) bot.pos.z = nextZ;
    else bot.vel.z = 0;
  }

  // Line of sight from a bot's eye to a point: true when no wall is closer.
  function hasLOS(from, to) {
    eye.copy(from);
    dir.copy(to).sub(from);
    const dist = dir.length();
    dir.normalize();
    raycaster.set(eye, dir);
    raycaster.far = dist;
    return raycaster.intersectObjects(shootables, false).length === 0;
  }

  function chestOf(bot) {
    return chest.set(bot.pos.x, bot.pos.y + 1.1, bot.pos.z);
  }

  // Pick the nearest visible enemy for a bot: other-team bots, plus the
  // player when this bot is a defender. Returns {bot, isPlayer, point}.
  function perceive(bot, player, time) {
    let best = null;
    let bestDist = 42;
    const forward = tmp.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const consider = (point, dist, isPlayer, target) => {
      if (dist >= bestDist) return;
      dir.copy(point).sub(eye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z)).normalize();
      if (!bot.heard || time - bot.heard.t > 3) {
        if (dir.dot(forward) < 0.25) return;
      }
      if (!hasLOS(eye, point)) return;
      bestDist = dist;
      best = { target, isPlayer, point: point.clone(), dist: bestDist };
    };
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const point = chestOf(other);
      consider(point, eye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z).distanceTo(point), false, other);
    }
    if (bot.team === 'def' && player.alive) {
      const point = new THREE.Vector3(player.pos.x, player.pos.y + (player.crouching ? 0.8 : 1.2), player.pos.z);
      consider(point, eye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z).distanceTo(point), true, null);
    }
    return best;
  }

  function shootAt(bot, target, isPlayer, time) {
    // Aim at the chest with an error that grows with distance, target
    // speed and the bot's (lack of) skill.
    const aim = target.isPlayer
      ? new THREE.Vector3(target.point.x, target.point.y, target.point.z)
      : chestOf(target.target);
    const dist = bot.pos.distanceTo(aim);
    const speed = target.isPlayer ? target.speed : Math.hypot(target.target.vel.x, target.target.vel.z);
    const error = (0.015 + dist * 0.0011 + speed * 0.006) * (1.5 - bot.skill);
    muzzle.set(bot.pos.x - Math.sin(bot.yaw) * 0.5, bot.pos.y + 1.35, bot.pos.z - Math.cos(bot.yaw) * 0.5);
    dir.copy(aim).sub(muzzle).normalize();
    dir.x += (random() * 2 - 1) * error;
    dir.y += (random() * 2 - 1) * error;
    dir.z += (random() * 2 - 1) * error;
    dir.normalize();

    // Walls first: the shot stops at the nearest wall.
    raycaster.set(muzzle, dir);
    raycaster.far = 60;
    const wallHits = raycaster.intersectObjects(shootables, false);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
    let end = tmp.copy(muzzle).addScaledVector(dir, Math.min(wallDist, 60));

    if (target.isPlayer) {
      const p = target.point;
      const crouch = target.crouching;
      const bodyTop = crouch ? 1.12 : 1.45;
      const headTop = crouch ? 1.12 : HEIGHT;
      tmpMin.set(p.x - RADIUS, p.y, p.z - RADIUS);
      tmpMax.set(p.x + RADIUS, p.y + bodyTop, p.z + RADIUS);
      const bodyT = rayAABB(muzzle, dir, tmpMin, tmpMax);
      tmpMin.set(p.x - 0.2, p.y + bodyTop, p.z - 0.2);
      tmpMax.set(p.x + 0.2, p.y + headTop, p.z + 0.2);
      const headT = rayAABB(muzzle, dir, tmpMin, tmpMax);
      const hitT = Math.min(bodyT, headT);
      if (hitT < wallDist && hitT < Infinity) {
        end = tmp.copy(muzzle).addScaledVector(dir, hitT);
        hooks.onDamagePlayer(headT < bodyT ? BOT_DAMAGE_HEAD : BOT_DAMAGE_BODY, headT < bodyT, bot);
      }
    } else {
      raycaster.set(muzzle, dir);
      const hits = raycaster.intersectObjects([target.target.torso, target.target.head], false);
      if (hits.length && hits[0].distance < wallDist) {
        end = tmp.copy(muzzle).addScaledVector(dir, hits[0].distance);
        const head = hits[0].object.userData.part === 'head';
        damage(target.target, head ? BOT_DAMAGE_HEAD : BOT_DAMAGE_BODY, bot, head);
      }
    }
    fireTracer(muzzle, end);
    bot.flash.visible = true;
    bot.flashLeft = 0.06;
  }

  function damage(bot, amount, attacker, head) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.state === 'defuse') {
      bot.state = 'engage';
      bot.defuseT = 0;
    }
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.state = 'dead';
    bot.fall = 0;
    bot.vel.set(0, 0, 0);
    hooks.onKill(attacker ? attacker.name : 'you', bot.name, !!head);
    return true;
  }

  function pickRoute(bot, siteId) {
    if (bot.team === 'def') {
      // Defenders split: two hold A, two hold B, one watches mid.
      const site = bot.index < 2 ? 'A' : bot.index < 4 ? 'B' : 'mid';
      const holds = site === 'A' ? ROUTES.holdA : site === 'B' ? ROUTES.holdB : ROUTES.holdMid;
      bot.hold = holds[bot.index % holds.length];
      bot.route = [[bot.hold[0], bot.hold[1]]];
      bot.waypoint = 0;
      bot.state = 'advance';
      return;
    }
    if (siteId === 'A') bot.route = ROUTES.atkA;
    else if (siteId === 'B') bot.route = ROUTES.atkB;
    else {
      bot.route = ROUTES.atkMid.concat(random() > 0.5 ? ROUTES.midToA : ROUTES.midToB);
    }
    bot.waypoint = 0;
    bot.state = 'advance';
  }

  function reset(roundSite) {
    for (const bot of bots) {
      const spawn = bot.team === 'atk' ? SPAWNS.atk[bot.index + 1] : SPAWNS.def[bot.index];
      bot.pos.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.vel.set(0, 0, 0);
      bot.health = 100;
      bot.alive = true;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.copy(bot.pos);
      bot.target = null;
      bot.mag = MAG;
      bot.reloadLeft = 0;
      bot.cooldown = 0;
      bot.burst = 0;
      bot.burstPause = 0;
      bot.fall = 0;
      bot.defuseT = 0;
      bot.heard = null;
      bot.defuseTarget = null;
      pickRoute(bot, roundSite);
    }
    for (const tracer of tracers) {
      tracer.mesh.visible = false;
      tracer.life = 0;
    }
  }

  function step(dt, time, player) {
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.mesh.material.opacity = Math.max(0, tracer.life / 0.08) * 0.85;
        if (tracer.life <= 0) tracer.mesh.visible = false;
      }
    }
    for (const bot of bots) {
      if (bot.flashLeft > 0) {
        bot.flashLeft -= dt;
        if (bot.flashLeft <= 0) bot.flash.visible = false;
      }
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        continue;
      }
      bot.group.rotation.y = bot.yaw;

      // Perception, staggered by bot index so not every bot scans each step.
      if (time - bot.seenAt > 0.12 + bot.index * 0.02 || bot.target) {
        const found = perceive(bot, player, time);
        // A bot running to defuse ignores distant contacts and keeps
        // moving; it only stops to fight what is close enough to kill it.
        const ignore = found && bot.defuseTarget && found.dist > 12;
        if (found && !ignore) {
          if (!bot.target) bot.reactAt = time + bot.reaction;
          bot.target = found;
          bot.seenAt = time;
          if (bot.state !== 'defuse') bot.state = 'engage';
        } else if (bot.target && time - bot.seenAt > 1.5) {
          bot.target = null;
          bot.state = bot.route && bot.waypoint < bot.route.length ? 'advance' : 'hold';
        }
      }

      if (bot.state === 'engage' && bot.target) {
        const targetPos = bot.target.isPlayer
          ? new THREE.Vector3(bot.target.point.x, bot.pos.y, bot.target.point.z)
          : bot.target.target.pos;
        const dx = targetPos.x - bot.pos.x;
        const dz = targetPos.z - bot.pos.z;
        bot.yaw = Math.atan2(-dx, -dz);
        // Strafe slowly while firing so a bot is not a static target.
        const strafe = Math.sin(time * 1.3 + bot.phase) * bot.strafeDir * 1.1;
        bot.vel.set(-Math.cos(bot.yaw) * strafe, 0, Math.sin(bot.yaw) * strafe);
        moveBot(bot, dt);
        if (time >= bot.reactAt) {
          bot.cooldown -= dt;
          if (bot.reloadLeft > 0) {
            bot.reloadLeft -= dt;
            if (bot.reloadLeft <= 0) bot.mag = MAG;
          } else if (bot.burstPause > 0) {
            bot.burstPause -= dt;
          } else if (bot.cooldown <= 0 && bot.mag > 0) {
            bot.cooldown = FIRE_GAP;
            bot.mag -= 1;
            bot.burst += 1;
            shootAt(bot, bot.target, bot.target.isPlayer, time);
            if (bot.burst >= 3 + Math.floor(random() * 3)) {
              bot.burst = 0;
              bot.burstPause = 0.6 + random() * 0.5;
            }
            if (bot.mag === 0) bot.reloadLeft = RELOAD_TIME;
          }
        }
      } else if (bot.state === 'advance' && bot.route) {
        const wp = bot.route[bot.waypoint];
        if (!wp) {
          bot.state = 'hold';
          bot.holdYaw = bot.yaw;
        } else {
          const dx = wp[0] - bot.pos.x;
          const dz = wp[1] - bot.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.6) {
            bot.waypoint += 1;
          } else {
            bot.yaw = Math.atan2(-dx, -dz);
            bot.vel.set((dx / dist) * SPEED, 0, (dz / dist) * SPEED);
            moveBot(bot, dt);
          }
        }
      } else if (bot.state === 'hold') {
        bot.vel.set(0, 0, 0);
        bot.yaw = bot.holdYaw + Math.sin(time * 0.5 + bot.phase) * 0.9;
      } else if (bot.state === 'defuse') {
        bot.vel.set(0, 0, 0);
        bot.defuseT += dt;
        if (bot.defuseT >= 5) hooks.onDefused();
      }

      // Low health: fall back toward the team's spawn for a few seconds.
      if (bot.alive && bot.health < 35 && bot.state !== 'defuse' && bot.state !== 'engage') {
        const back = bot.team === 'atk' ? 1 : -1;
        bot.vel.set(0, 0, back * SPEED * 0.6);
        moveBot(bot, dt);
      }
    }
  }

  return {
    bots,
    hitMeshes,
    damage,
    reset,
    step,
    fireTracer,
    aliveCount(team) {
      return bots.filter((bot) => bot.team === team && bot.alive).length;
    },
    aimPoint(index) {
      const bot = bots[index % bots.length];
      return new THREE.Vector3(bot.pos.x, bot.pos.y + 1.1, bot.pos.z);
    },
    nearestDefender(site) {
      let best = null;
      let bestDist = Infinity;
      for (const bot of bots) {
        if (bot.team !== 'def' || !bot.alive) continue;
        const d = Math.hypot(bot.pos.x - site.center.x, bot.pos.z - site.center.z);
        if (d < bestDist) {
          bestDist = d;
          best = bot;
        }
      }
      return best;
    },
    sendToDefuse(bot, site) {
      bot.target = null;
      bot.defuseT = 0;
      bot.defuseTarget = site;
      bot.route = [[site.center.x, site.center.z]];
      bot.waypoint = 0;
      bot.state = 'advance';
    },
    sendToSite(bot, site) {
      bot.target = null;
      bot.route = [[site.center.x, site.center.z]];
      bot.waypoint = 0;
      bot.state = 'advance';
    },
    updateDefuse(dt) {
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'def' || !bot.defuseTarget) continue;
        const site = bot.defuseTarget;
        const d = Math.hypot(bot.pos.x - site.center.x, bot.pos.z - site.center.z);
        if (d < 1.6 && bot.state === 'advance') {
          bot.state = 'defuse';
          bot.vel.set(0, 0, 0);
        }
      }
    },
    notifyShot(pos, team, time) {
      for (const bot of bots) {
        if (bot.team === team || !bot.alive) continue;
        if (bot.pos.distanceTo(pos) < 18) bot.heard = { pos: pos.clone(), t: time };
      }
    },
  };
}
