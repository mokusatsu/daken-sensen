"use strict";

const rules = {
  lanes: 10,
  homes: [106, 894],
  forts: [76, 925],
  directions: [1, -1],
  gap: 16,
  queueSpacing: 43,
  baseHealth: 620,
  initialCost: 450,
  costLimit: 720,
  income: 14,
  unitLimit: 15,
  step: 1 / 60,
  frontlineFirst: true,
};
const balance = {
  hp: [110, 147, 188, 232, 272],
  power: [21, 35, 38, 60, 155],
  range: [57, 87, 113, 206, 255],
  speed: [86, 105, 124, 148, 174],
  recovery: [1.05, .78, .46, .27, .12],
  cost: [44, 79, 101, 118, 131],
  redeploy: [7, 5.8, 4.4, 3, 1.7],
  cover: .77,
  splash: 1,
  slow: .57,
  guard: .55,
  steady: true,
  closeShot: .58,
};
const traits = {
  m: {description: "低コストと短い再出撃で前線に増援を送る"},
  w: {description: "高い体力とのけぞり耐性で前線を支える"},
  r: {description: "移動が速く、会敵やのけぞり後の復帰に強い"},
  s: {description: "短い攻撃間隔で2回打撃し、小さく押し戻す", push: .46},
  l: {description: "長射程から単体を狙う。距離が近すぎると威力が落ちる", comfort: 75},
  a: {description: "着弾点の周りにいる敵にも打撃を広げる", spread: 3, splash: .72},
  b: {description: "高い体力と重い近接攻撃で前列を押し戻す", spread: 1, splash: .33, push: 1.23, steady: true},
  h: {description: "長い溜めから大威力の範囲攻撃を撃つ", spread: 2, extra: 3, splash: .49, push: 1.25, steady: true},
  c: {description: "周囲の敵にも命中し、前進と復帰を遅らせる", spread: 1, splash: .28, slow: 2.6},
  u: {description: "体力と威力を備え、前線の後ろからも攻撃する"},
};
const reactions = {
  .25: [10, .095],
  .5: [16, .135],
  1: [27, .18],
  2: [42, .24],
  4: [62, .32],
};
const sides = ["敵", "味方"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function makeCard(card, level = 1, tuning = balance) {
  const [stamina, power, range, speed, speedOfAttack, price, speedOfDeploy] = card.ratings.map(rank => rank - 1);
  const growth = 9 + level;
  return {
    ...card, level,
    hp: Math.round(tuning.hp[stamina] * growth / 10),
    power: Math.round(tuning.power[power] * growth / 10),
    range: tuning.range[range],
    speed: tuning.speed[speed],
    recovery: tuning.recovery[speedOfAttack],
    cost: tuning.cost[price],
    redeploy: tuning.redeploy[speedOfDeploy],
  };
}

function createBattle(data, seed, options = {}) {
  const settings = {...rules, ...options.settings};
  const tuning = options.tuning ?? balance;
  const byId = new Map(data.cards.map(card => [card.id, card]));
  const decks = options.decks ?? data.opening;
  return {
    data, settings, tuning, trace: options.trace ?? true,
    time: 0, serial: 0, front: null, winner: null, units: [], effects: [], events: [], lastHit: null,
    teams: decks.map((deck, team) => {
      const cards = deck.map(id => makeCard(byId.get(id), options.levels?.[team]?.[id] ?? 1, tuning));
      return {
        cards, seed: (seed ^ (team ? 0x9e3779b9 : 0xc2b2ae35)) >>> 0,
        auto: options.auto?.[team] ?? true,
        health: settings.baseHealth, cost: settings.initialCost, nextBuy: 0, nextCard: null,
        ready: new Map(cards.map(card => [card.id, 0])),
        purchases: new Map(cards.map(card => [card.id, 0])),
        stats: {hits: 0, damage: 0, splash: 0, slowed: 0, rear: 0},
      };
    }),
  };
}

function random(army) {
  army.seed = (Math.imul(army.seed, 1664525) + 1013904223) >>> 0;
  return army.seed / 4294967296;
}

function recordEvent(battle, text, team = null) {
  if (!battle.trace) return;
  battle.events.unshift({text, team, time: battle.time});
  if (battle.events.length > 7) battle.events.pop();
}

function enlist(battle, team, card, lane) {
  const unit = {
    id: ++battle.serial, team, card, lane, u: rules.homes[team],
    hp: card.hp, born: battle.time, readyAt: battle.time,
    attack: null, recoil: null, returnTo: null, slowedUntil: 0, moving: true,
  };
  battle.units.push(unit);
  return unit;
}

function deploy(battle, team, cardId) {
  const army = battle.teams[team];
  const card = army.cards.find(entry => entry.id === cardId);
  if (battle.winner !== null || !card || army.cost < card.cost || battle.time < army.ready.get(cardId)) return false;
  const counts = Array(rules.lanes).fill(0);
  const blocked = new Set();
  let size = 0;
  for (const unit of battle.units) {
    if (unit.team !== team) continue;
    size++;
    counts[unit.lane]++;
    if (Math.abs(unit.u - rules.homes[team]) < rules.queueSpacing) blocked.add(unit.lane);
  }
  if (size >= battle.settings.unitLimit) return false;
  const open = counts.map((count, lane) => ({count, lane})).filter(slot => !blocked.has(slot.lane));
  if (!open.length) return false;
  const fewest = Math.min(...open.map(slot => slot.count));
  const lanes = open.filter(slot => slot.count === fewest);
  enlist(battle, team, card, lanes[Math.floor(random(army) * lanes.length)].lane);
  army.cost -= card.cost;
  army.ready.set(cardId, battle.time + card.redeploy);
  army.purchases.set(cardId, army.purchases.get(cardId) + 1);
  if (army.nextCard === cardId) army.nextCard = null;
  recordEvent(battle, sides[team] + "の " + card.name + " が出撃", team);
  return true;
}

function buyUnits(battle, dt) {
  const {costLimit, income, teamIncome} = battle.settings;
  for (const [team, army] of battle.teams.entries()) {
    army.cost = Math.min(costLimit, army.cost + dt * (teamIncome?.[team] ?? income));
    if (!army.auto || battle.time < army.nextBuy) continue;
    army.nextBuy = battle.time + .42 + random(army) * .34;
    if (army.nextCard === null) {
      const ready = army.cards.filter(card => battle.time >= army.ready.get(card.id));
      if (!ready.length) continue;
      const front = battle.settings.frontlineFirst && !battle.units.some(unit =>
        unit.team === team && unit.card.ratings[2] <= 2) ? ready.filter(card => card.ratings[2] <= 2) : [];
      const candidates = front.length ? front : ready;
      army.nextCard = candidates[Math.floor(random(army) * candidates.length)].id;
    }
    deploy(battle, team, army.nextCard);
  }
}

function laneStop(battle, team) {
  return battle.front === null ? rules.homes[1 - team] : battle.front - rules.directions[team] * rules.gap;
}

function activeUnit(unit) {
  return unit.hp > 0 && !unit.recoil && unit.returnTo === null;
}

function holdsFront(battle, unit) {
  if (battle.front === null || unit.hp <= 0 || (unit.recoil && unit.returnTo === null)) return false;
  const position = unit.returnTo ?? unit.u;
  return Math.abs(position - laneStop(battle, unit.team)) < .04;
}

function atLine(battle, unit) {
  return activeUnit(unit) && holdsFront(battle, unit);
}

function advanceUnits(battle, dt) {
  for (const unit of battle.units) {
    if (!unit.recoil) continue;
    const {from, to, start, duration} = unit.recoil;
    const offset = clamp((battle.time - start) / duration, 0, 1);
    const position = from + (to - from) * (1 - (1 - offset) ** 3);
    const direction = rules.directions[unit.team];
    unit.u = Math.min(position * direction, laneStop(battle, unit.team) * direction) * direction;
    unit.moving = false;
    if (offset === 1) unit.recoil = null;
  }
  for (const [team, direction] of rules.directions.entries()) {
    const order = battle.units.filter(unit => unit.team === team).sort((a, b) => (b.u - a.u) * direction);
    const forward = laneStop(battle, team) * direction;
    const room = Array(rules.lanes).fill(forward);
    const home = rules.forts[team] * direction;
    const covered = battle.front !== null && order.some(unit =>
      !unit.recoil && unit.card.ratings[2] <= 2 && forward - unit.u * direction <= 44);
    for (const unit of order) {
      if (!unit.recoil) {
        const position = unit.u * direction;
        const returning = unit.returnTo === null ? -Infinity : Math.min(forward, unit.returnTo * direction);
        const depth = covered && unit.card.ratings[2] >= 3 ? (unit.card.range - 75) * battle.tuning.cover : 0;
        const stop = Math.min(room[unit.lane], Math.max(forward - depth, position, returning));
        const speed = unit.card.speed * (battle.time < unit.slowedUntil ? battle.tuning.slow : 1);
        unit.u = Math.max(home, Math.min(stop, position + speed * dt)) * direction;
        unit.moving = Math.abs(unit.u * direction - position) > .05;
        if (unit.u * direction >= returning - .04) {
          unit.returnTo = null;
          if (unit.attack?.pausedAt != null) {
            unit.attack.start += battle.time - unit.attack.pausedAt;
            unit.attack.pausedAt = null;
          }
        }
      }
      room[unit.lane] = Math.min(room[unit.lane], unit.u * direction - rules.queueSpacing);
    }
  }
}

function findFront(battle) {
  if (battle.front !== null) return;
  let enemy = -Infinity;
  let ally = Infinity;
  for (const unit of battle.units) {
    if (!activeUnit(unit)) continue;
    if (unit.team === 0) enemy = Math.max(enemy, unit.u);
    else ally = Math.min(ally, unit.u);
  }
  if (enemy < rules.homes[0] || ally > rules.homes[1] || ally - enemy > rules.gap * 2) return;
  battle.front = clamp((ally + enemy) / 2, rules.homes[0] + rules.gap, rules.homes[1] - rules.gap);
  for (const unit of battle.units) {
    const stop = laneStop(battle, unit.team);
    unit.u = unit.team === 0 ? Math.min(unit.u, stop) : Math.max(unit.u, stop);
  }
  recordEvent(battle, "会敵ラインが固定された");
}

function affinity(matchups, type, defenseTypes) {
  return defenseTypes.reduce((value, defense) => value * matchups[type][defense], 1);
}

function bestAttackType(matchups, attackTypes, defenseTypes) {
  let best = null;
  for (const type of attackTypes) {
    const factor = affinity(matchups, type, defenseTypes);
    if (!best || factor > best.factor) best = {type, factor};
  }
  return best;
}

function inRange(attacker, unit) {
  return unit.team !== attacker.team && activeUnit(unit) && Math.abs(unit.u - attacker.u) <= attacker.card.range;
}

function bestTarget(battle, attacker) {
  if (!activeUnit(attacker)) return null;
  if (battle.front === null) {
    const baseTeam = 1 - attacker.team;
    return Math.abs(attacker.u - rules.homes[baseTeam]) < .04
      ? {baseTeam, type: attacker.card.type[0], factor: 1} : null;
  }
  let best = null;
  const comfort = traits[attacker.card.role].comfort ?? 0;
  for (const unit of battle.units) {
    if (!inRange(attacker, unit)) continue;
    const hit = bestAttackType(battle.data.matchups, attacker.card.type, unit.card.type);
    const strength = Math.abs(attacker.u - unit.u) < comfort ? battle.tuning.closeShot : 1;
    const score = hit.factor * strength;
    const laneDistance = Math.abs(attacker.lane - unit.lane);
    if (!best || score > best.score ||
        (score === best.score && (laneDistance < best.laneDistance ||
          (laneDistance === best.laneDistance && unit.hp < best.unit.hp)))) {
      best = {...hit, unit, laneDistance, strength, score};
    }
  }
  return best;
}

function hitTarget(battle, attacker, target, ratio = 1) {
  const {unit, baseTeam, factor, type} = target;
  const card = attacker.card;
  const damage = factor ? Math.max(1, Math.round(card.power * ratio * (target.strength ?? 1) * factor / card.impactFrames.length)) : 0;
  const role = traits[card.role];
  const stats = battle.teams[attacker.team].stats;
  const splash = ratio !== 1;
  if (battle.trace) {
    const victim = unit ? unit.card.name : sides[baseTeam] + "拠点";
    battle.effects.push({
      time: battle.time, factor, damage, type, role: card.role, splash,
      slow: !!unit && !!damage && !!role.slow,
      u: unit ? unit.u : rules.homes[baseTeam], lane: unit ? unit.lane : 4.5,
      fromU: attacker.u, fromLane: attacker.lane, team: attacker.team,
      seed: attacker.id * 71 + (unit?.id ?? 124),
    });
    if (!splash) battle.lastHit = {attacker: card.name, victim, factor, damage, type};
  }
  if (unit) {
    if (!damage) return;
    stats.hits++;
    stats.damage += Math.min(unit.hp, damage);
    if (splash) stats.splash++;
    if (Math.abs(attacker.u - laneStop(battle, attacker.team)) > rules.queueSpacing) stats.rear++;
    unit.hp -= damage;
    if (unit.hp <= 0) {
      if (battle.trace) recordEvent(battle, sides[unit.team] + "の " + unit.card.name + " が離脱", unit.team);
      return;
    }
    if (battle.tuning.steady && traits[unit.card.role].steady && factor <= 1 && unit.attack) {
      unit.attack.pausedAt ??= battle.time;
    } else {
      unit.attack = null;
    }
    const [distance, duration] = reactions[factor];
    const force = (role.push ?? 1) * (unit.card.role === "w" ? battle.tuning.guard : 1) * (splash ? .64 : 1);
    const recoil = {
      from: unit.u, to: clamp(unit.u - rules.directions[unit.team] * distance * force, ...rules.forts),
      start: battle.time, duration: Math.max(.055, duration * force),
    };
    unit.returnTo = unit.u;
    if (!unit.recoil || recoil.duration > unit.recoil.duration) unit.recoil = recoil;
    if (role.slow) {
      unit.slowedUntil = Math.max(unit.slowedUntil, battle.time + role.slow * (splash ? .65 : 1));
      stats.slowed++;
    }
    unit.moving = false;
    return;
  }
  const base = battle.teams[baseTeam];
  base.health = Math.max(0, base.health - damage);
  if (!base.health) {
    battle.winner = attacker.team;
    recordEvent(battle, sides[attacker.team] + "の勝利", attacker.team);
  }
}

function queueStrike(battle, attacker, target, attacks) {
  const role = traits[attacker.card.role];
  const primary = target.unit;
  attacks.push({attacker, target, ratio: 1});
  if (!primary || !role.spread || !battle.tuning.splash) return;
  const nearby = battle.units.filter(unit => unit !== primary && inRange(attacker, unit) &&
    Math.abs(unit.u - primary.u) <= 52 && Math.abs(unit.lane - primary.lane) <= role.spread);
  nearby.sort((a, b) => Math.abs(a.lane - primary.lane) - Math.abs(b.lane - primary.lane) ||
    Math.abs(a.u - primary.u) - Math.abs(b.u - primary.u));
  for (const unit of nearby.slice(0, role.extra ?? 2)) {
    const factor = affinity(battle.data.matchups, target.type, unit.card.type);
    attacks.push({attacker, target: {unit, type: target.type, factor}, ratio: role.splash * battle.tuning.splash});
  }
}

function fight(battle) {
  const attacks = [];
  for (const actor of battle.units) {
    if (!activeUnit(actor)) continue;
    if (!actor.attack) {
      if (battle.time >= actor.readyAt && bestTarget(battle, actor)) actor.attack = {start: battle.time, next: 0};
      continue;
    }
    const elapsed = battle.time - actor.attack.start;
    const {impactFrames, frames, recovery} = actor.card;
    while (actor.attack.next < impactFrames.length && elapsed >= impactFrames[actor.attack.next] / battle.data.fps) {
      actor.attack.next++;
      const target = bestTarget(battle, actor);
      if (target) queueStrike(battle, actor, target, attacks);
    }
    if (elapsed >= frames / battle.data.fps) {
      actor.attack = null;
      actor.readyAt = battle.time + recovery;
    }
  }
  // 同じ時刻に命中した攻撃は、出撃順だけで片方が取り消されないようにする。
  for (const {attacker, target, ratio} of attacks) {
    if (battle.winner !== null) break;
    if (target.unit?.hp <= 0) continue;
    hitTarget(battle, attacker, target, ratio);
  }
}

function stepBattle(battle, dt = rules.step) {
  if (battle.winner !== null) return;
  battle.time += dt;
  buyUnits(battle, dt);
  advanceUnits(battle, dt);
  findFront(battle);
  fight(battle);
  battle.units = battle.units.filter(unit => unit.hp > 0);
  if (battle.front !== null) {
    const holding = [false, false];
    for (const unit of battle.units) {
      if (holdsFront(battle, unit)) holding[unit.team] = true;
    }
    if (!holding[0] || !holding[1]) {
      const fallen = !holding[0] && !holding[1] ? "両陣営" : sides[holding[0] ? 1 : 0];
      battle.front = null;
      for (const unit of battle.units) unit.returnTo = null;
      recordEvent(battle, fallen + "の前列が崩れ、会敵ラインが解除された");
    }
  }
  if (battle.trace) battle.effects = battle.effects.filter(effect => battle.time - effect.time < 1);
}

if (typeof module !== "undefined") {
  module.exports = {
    rules, balance, traits, makeCard, createBattle, deploy, enlist, advanceUnits, stepBattle,
    laneStop, activeUnit, holdsFront, bestTarget, hitTarget, fight,
  };
}
