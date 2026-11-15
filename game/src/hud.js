// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, team
// scores, kill feed, bomb status, round banner, plant progress and the buy
// menu, plus the one overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';

const COPY = {
  start: {
    title: 'Emberline',
    copy: 'A tactical round-based shooter in a desert yard. Plant the bomb at Site A or B — or eliminate the VEX squad. Earn money each round and spend it between rounds. First to 8 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchWin: {
    title: 'Match won',
    copy: 'Ember takes the yard.',
    action: 'Play again',
  },
  matchLose: {
    title: 'Match lost',
    copy: 'VEX holds the yard.',
    action: 'Play again',
  },
};

const BUY_ROWS = [
  { key: '1', id: 'rifle' },
  { key: '2', id: 'smg' },
  { key: '3', id: 'sniper' },
  { key: '4', id: 'pistol' },
  { key: 'G', id: 'grenade' },
  { key: 'V', id: 'armor' },
];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const moneyEl = $('money');
  const weaponName = $('weapon-name');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const armorEl = $('armor');
  const timerEl = $('timer');
  const scoreAtk = $('score-atk-num');
  const scoreDef = $('score-def-num');
  const bombStatus = $('bomb-status');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const progress = $('progress');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const buyPanel = $('buy');
  const buyMoney = $('buy-money');
  const buyRows = $('buy-rows');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastBomb = '';

  function renderBuy(money, owned) {
    buyRows.innerHTML = '';
    for (const row of BUY_ROWS) {
      const div = document.createElement('div');
      div.className = 'buy-row';
      let label;
      let price;
      let isOwned = false;
      if (row.id === 'grenade') {
        label = 'HE Grenade';
        price = GRENADE_PRICE;
        isOwned = owned.grenades > 0;
      } else if (row.id === 'armor') {
        label = 'Kevlar Armor';
        price = ARMOR_PRICE;
        isOwned = owned.armor > 0;
      } else {
        label = WEAPONS[row.id].label;
        price = WEAPONS[row.id].price;
        isOwned = owned.weapons.includes(row.id);
      }
      if (isOwned) div.classList.add('owned');
      const name = document.createElement('span');
      name.innerHTML = `<span class="key">${row.key}</span>${label}`;
      const priceEl = document.createElement('span');
      priceEl.className = 'price' + (isOwned ? ' owned' : '');
      priceEl.textContent = isOwned ? 'OWNED' : `$${price}`;
      div.append(name, priceEl);
      buyRows.appendChild(div);
    }
    buyMoney.textContent = `$${money}`;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeaponName(label) {
      weaponName.textContent = label;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value}`;
    },
    setHealth(hp, armor) {
      if (hp === lastHealth && armor === lastArmor) return;
      lastHealth = hp;
      lastArmor = armor;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
      armorEl.textContent = armor > 0 ? `+${armor} armor` : '';
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('low', s <= 15);
    },
    setScore(atk, def) {
      const text = `${atk}-${def}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreAtk.textContent = String(atk);
      scoreDef.textContent = String(def);
    },
    setBombStatus(text, planted) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('planted', !!planted);
    },
    showBanner(titleText, subText) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), 3500);
    },
    hideBanner() {
      banner.classList.remove('on');
      clearTimeout(bannerTimer);
    },
    showProgress(label, frac) {
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    hideProgress() {
      progress.hidden = true;
    },
    addKill(killer, victim, killerTeam) {
      const div = document.createElement('div');
      const killerSpan = document.createElement('span');
      killerSpan.className = killerTeam === 'atk' ? 'atk' : 'def';
      killerSpan.textContent = killer;
      const victimSpan = document.createElement('span');
      victimSpan.className = killerTeam === 'atk' ? 'def' : 'atk';
      victimSpan.textContent = victim;
      div.append(killerSpan, document.createTextNode(' ✕ '), victimSpan);
      killfeed.prepend(div);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    showBuy(money, owned) {
      renderBuy(money, owned);
      buyPanel.hidden = false;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    showOverlay(mode, scoreText) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = scoreText ? `${text.copy} Final score ${scoreText}.` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
