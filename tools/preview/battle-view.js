"use strict";

const art = JSON.parse(document.querySelector("#battle-art").textContent);
const get = id => document.getElementById(id);
const field = get("field");
const worldContext = field.getContext("2d");
const backdrop = document.createElement("canvas");
const atlases = new Map();
const compact = matchMedia("(max-width: 640px)");
const yaw = art.camera.heading * Math.PI / 180;
const cameraSin = Math.sin(yaw);
const cameraCos = Math.cos(yaw);
const flags = ["#ffad8b", "#b6b2ff"];
const impactStyles = {
  .25: {name: "かなりいまひとつ", tone: "#c7b2df", edge: "#795f9a", radius: 9, rank: 1},
  .5: {name: "いまひとつ", tone: "#b6e3fa", edge: "#5d8bb2", radius: 14, rank: 2},
  1: {name: "等倍", tone: "#fff2cb", edge: "#b6844b", radius: 20, rank: 3},
  2: {name: "ばつぐん", tone: "#ffb576", edge: "#df5354", radius: 30, rank: 4},
  4: {name: "ちょうばつぐん", tone: "#fff6a8", edge: "#fa658f", radius: 44, rank: 5},
  0: {name: "無効", tone: "#c6cadf", edge: "#70758d", radius: 14, rank: 0},
};
const step = rules.step;
const initialSeed = 0x503df971;
const cardsById = new Map(art.cards.map(card => [card.id, card]));
const plans = new Map(art.presets.map(preset => [preset.id, preset]));
const imported = readFormation();
const session = new URLSearchParams(location.search).has("stage") ? openCampaign(art.opening[1]) : null;
const drill = session && new URLSearchParams(location.search).get("exercise") === "daily"
  ? FieldOrders.daily(FieldOrders.dayKey()) : null;
const frontStages = session ? art.stages.filter(entry => entry.country === session.country) : [];
const campaignStage = session && stageAvailable(frontStages, session.stageId, session.front.cleared)
  ? frontStages.find(entry => entry.id === session.stageId) : null;
const stage = drill ? {name: drill.name, number: 12, region: "日替わり演習", boss: false,
  enemies: plans.get(drill.enemy).ids.map(id => ({id, level: 1}))} : campaignStage;
const validTeam = session?.state.slots.some(id => cardsById.has(id));
if (session && (!stage || (!drill && !validTeam))) GamePlayers.go(session.href(session.mapFile));
const guide = get("battle-guide");
const outcome = get("outcome");
const reveal = get("recruit-reveal");
const details = get("battle-details");
const summonKeys = ["A", "S", "D", "F", "G"];
const radio = fieldRadio(session?.state.volume ?? .6);
let scene;
let battle;
let allySlots = [];
let paused = false;
let loading = false;
let restartId = 0;
let resultShown = false;
let countdownRemaining = 0;
let promptDeck;
let score;
let battleSeed;
let bossReserve = false;
let messageUntil = 0;
let activeSeconds = 0;
let orderPulse;
let lastBreachAt = -Infinity;
let lastBaseHp = [rules.baseHealth, rules.baseHealth];
let timeout = false;
let touchVisible = session?.state.touchKeys ?? matchMedia("(pointer: coarse)").matches;
let lastTouchHint;
let typingEngine = null;
let sample = null;
let frameRequest = 0;
let priorTime = 0;
let sinceHud = 0;
let accumulator = 0;
let eventHead = null;
let lastInHud = null;

function make(tag, text, css) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (css) element.className = css;
  return element;
}

function readFormation() {
  const raw = new URLSearchParams(location.hash.slice(1)).get("formation");
  if (!raw) return null;
  try {
    const {ids, levels} = JSON.parse(raw);
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length ||
        ids.some(id => !cardsById.has(id))) return null;
    const validLevels = Object.fromEntries(ids.map(id => {
      const level = levels?.[id];
      return [id, Number.isSafeInteger(level) && level > 0 && level <= 999 ? level : 1];
    }));
    return {id: "formation", label: "編成画面の部隊", ids, levels: validLevels};
  } catch {
    return null;
  }
}

function loadAtlas(id) {
  if (!atlases.has(id)) {
    const image = new Image();
    image.src = art.atlases[id];
    atlases.set(id, image);
  }
  return atlases.get(id).decode();
}

function drawPortrait(canvas, card) {
  const [x, y, w, h, , , atlasId] = card.portrait;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(atlases.get(atlasId), x, y, w, h, 0, 0, w, h);
}

function across(lane) {
  return (lane - (rules.lanes - 1) / 2) * 37;
}

function project(u, v, z = 0) {
  // スプライトの正面（ローカルの +y）をレーンに、左側（-x）を横方向に合わせる。
  const forward = u - 500;
  const x = -forward * cameraSin - v * cameraCos;
  const y = forward * cameraCos - v * cameraSin;
  return [scene.width / 2 + x * scene.scale, scene.middle + y * scene.scale * art.camera.pitch - z];
}

function polygon(ctx, points) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

function worldShape(ctx, points, color, z = 0) {
  polygon(ctx, points.map(([u, v]) => project(u, v, z)));
  ctx.fillStyle = color;
  ctx.fill();
}

function strip(ctx, left, right, near, far, color, z = 0) {
  worldShape(ctx, [[left, near], [right, near], [right, far], [left, far]], color, z);
}

function pathLine(ctx, from, to, color, width) {
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawBanners(ctx) {
  // The banners mark each approach outside the ten playable lanes.
  for (const [team, u] of [[0, 155], [1, 845]]) {
    for (const v of [-193, 193]) {
      const [x, y] = project(u, v);
      strip(ctx, u - 9, u + 9, v - 7, v + 7, "#65594e", 1);
      strip(ctx, u - 7, u + 7, v - 5, v + 5, "#d4c4a0", 4);
      const pole = Math.round(x);
      ctx.fillStyle = "#584643";
      ctx.fillRect(pole - 1, Math.round(y - 30), 3, 27);
      ctx.fillStyle = flags[team];
      polygon(ctx, [[pole + 2, y - 29], [pole + 17, y - 26], [pole + 12, y - 22], [pole + 15, y - 18], [pole + 2, y - 20]]);
      ctx.fill();
      ctx.fillStyle = "#fff1ce";
      ctx.fillRect(pole + 4, Math.round(y - 26), 3, 4);
    }
  }
}

function makeBackdrop() {
  scene = compact.matches
    ? {width: 880, height: 460, scale: .78, middle: 226}
    : {width: 1280, height: 535, scale: 1.12, middle: 258};
  field.width = backdrop.width = scene.width;
  field.height = backdrop.height = scene.height;
  const ctx = backdrop.getContext("2d");
  const {width, height} = scene;
  const ground = ctx.createLinearGradient(0, 0, width, height);
  const palettes = {
    "九州・沖縄": ["#284c57", "#183746", "#142b39", "#a9bc89", "#a2b885", "#86ada0"],
    "中国": ["#394755", "#283441", "#202b38", "#b6ac84", "#b9b089", "#a5a07d"],
    "四国": ["#2d5147", "#233c39", "#1b3032", "#a2ba7c", "#a9bf8a", "#89aa79"],
    "近畿": ["#554450", "#3b3344", "#2b2838", "#c9af81", "#c2ab82", "#a69f8a"],
    "中部": ["#344e59", "#293b44", "#202f3a", "#adc3a0", "#b6c8a9", "#a2b9a2"],
    "関東": ["#4b4656", "#343344", "#26293a", "#c0b497", "#b7ad98", "#aba398"],
    "東北": ["#3a4d5d", "#2c3c50", "#212e3f", "#b0c5bc", "#c8d4bd", "#9fb6ad"],
    "北海道": ["#46596d", "#334559", "#263549", "#d2e3df", "#c1d9dc", "#b3ccd4"],
    "北東部": ["#405464", "#304753", "#213340", "#b59571", "#b8aa80", "#a89373"],
    "中西部": ["#405b61", "#354955", "#263940", "#c9b87b", "#b9ae71", "#a79e72"],
    "南部": ["#485a52", "#314b4a", "#24403e", "#a6ba83", "#abb47a", "#8da57b"],
    "西部": ["#66555b", "#4e404c", "#36313d", "#d3a17c", "#c39778", "#ad876e"],
    "アラスカ": ["#425a72", "#324859", "#253b50", "#d9e9e7", "#bdd9db", "#aac8d1"],
    "ハワイ": ["#335e72", "#234b60", "#1a394c", "#aecb8e", "#aabb82", "#8ebda0"],
  };
  const colors = palettes[stage?.region] ?? ["#30434d", "#24353f", "#1c2d38", "#9ba778", "#a6b286", "#8fa88b"];
  ground.addColorStop(0, colors[0]);
  ground.addColorStop(.55, colors[1]);
  ground.addColorStop(1, colors[2]);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#8a86ad4c";
  for (let y = 10; y < height; y += 18) {
    for (let x = 8 + (y % 36 ? 9 : 0); x < width; x += 18) ctx.fillRect(x, y, 1.5, 1.5);
  }

  const rim = [[37, -185], [59, -206], [948, -206], [974, -182],
    [974, 183], [953, 204], [58, 204], [35, 185]];
  worldShape(ctx, rim, "#181729bb", -31);
  worldShape(ctx, rim, "#34334a", -25);
  worldShape(ctx, rim, "#534554", -21);
  worldShape(ctx, rim, "#74614f", -15);
  worldShape(ctx, rim, "#826d4d", -10);
  worldShape(ctx, rim, "#6c7957", -5);
  const grass = ctx.createLinearGradient(...project(26, 0), ...project(970, 0));
  grass.addColorStop(0, colors[3]);
  grass.addColorStop(.50, colors[4]);
  grass.addColorStop(1, colors[5]);
  worldShape(ctx, rim, grass);
  ctx.save();
  ctx.clip();
  strip(ctx, 35, 237, -205, 205, "#f2b8872a");
  strip(ctx, 760, 980, -205, 205, "#7c81bf25");
  for (let lane = 0; lane < rules.lanes; lane++) {
    const v = across(lane);
    strip(ctx, 91, 909, v - 14, v + 14, lane % 2 === 0 ? "#e2dbad43" : "#f0e5bd2b");
    pathLine(ctx, project(114, v + 14), project(885, v + 14), "#53685050", 1);
    for (let u = 190; u < 850; u += 80) {
      strip(ctx, u, u + 15, v - 1.3, v + 1.3, "#53674d60");
      strip(ctx, u + 20, u + 23, v - 1, v + 1, "#eee3b267");
    }
  }

  let seeds = 8291;
  function dot() {
    seeds = (Math.imul(seeds, 1664525) + 1013904223) >>> 0;
    return seeds / 4294967296;
  }
  for (let i = 0; i < 490; i++) {
    const u = 48 + dot() * 904;
    const v = -199 + dot() * 398;
    const w = 3 + dot() * 8;
    const dye = dot();
    strip(ctx, u, u + w, v, v + 2 + dot() * 3, dye > .62 ? "#dedcac60" : "#54744960");
  }
  // レーンの外側にだけ、地面から立つ草や石を置く。
  for (let i = 0; i < 51; i++) {
    const u = 61 + dot() * 887;
    const v = (dot() < .5 ? -1 : 1) * (177 + dot() * 20);
    const [x, y] = project(u, v);
    ctx.fillStyle = "#43594298";
    ctx.fillRect(Math.round(x) - 3, Math.round(y) - 1, 10, 3);
    ctx.fillStyle = dot() > .72 ? "#e6d4a4" : "#53754c";
    const h = 4 + Math.round(dot() * 9);
    ctx.fillRect(Math.round(x), Math.round(y - h), 3, h);
    ctx.fillRect(Math.round(x) + 4, Math.round(y - h * .56), 3, h * .56);
    ctx.fillStyle = "#b7bb81";
    ctx.fillRect(Math.round(x), Math.round(y - h), 2, 3);
  }
  for (const team of [0, 1]) {
    const u = team === 0 ? 89 : 910;
    const color = team === 0 ? "#eed0a4" : "#d6c8ec";
    strip(ctx, u - 24, u + 24, -46, 46, "#463f55a6");
    strip(ctx, u - 20, u + 20, -42, 42, color);
    strip(ctx, u - 15, u + 15, -34, 34, "#74728295");
    for (let lane = 0; lane < rules.lanes; lane++) {
      const v = across(lane);
      const markU = team === 0 ? 152 : 848;
      const dir = rules.directions[team];
      worldShape(ctx, [[markU, v - 5], [markU + dir * 12, v], [markU, v + 5], [markU + dir * 3, v]], color);
    }
  }
  ctx.restore();
  polygon(ctx, rim.map(point => project(...point)));
  ctx.strokeStyle = "#c8c795ba";
  ctx.lineWidth = 1.7;
  ctx.stroke();
  drawBanners(ctx);
}

function packed(ctx, frame, x, y, scale = 1) {
  const [sx, sy, w, h, ox, oy, atlasId] = frame;
  ctx.drawImage(atlases.get(atlasId), sx, sy, w, h, Math.round(x - ox * scale), Math.round(y - oy * scale),
    Math.round(w * scale), Math.round(h * scale));
}

function plaque(ctx, text, x, y, fill, ink) {
  ctx.font = '700 13px "Yu Gothic UI", "Meiryo", sans-serif';
  const width = Math.round(ctx.measureText(text).width) + 15;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - 11, width, 21, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawFront(ctx) {
  if (battle.front === null) return;
  const u = battle.front;
  strip(ctx, u - 6, u + 6, -198, 198, "#4835424e");
  const from = project(u, -198);
  const to = project(u, 198);
  pathLine(ctx, from, to, "#3d2a4dce", 6);
  ctx.setLineDash([12, 5]);
  pathLine(ctx, from, to, "#ffe5a2", 2.5);
  ctx.setLineDash([]);
  for (let lane = 0; lane < rules.lanes; lane++) {
    const v = across(lane);
    worldShape(ctx, [[u - 4, v], [u, v - 5], [u + 4, v], [u, v + 5]], "#fff0c6");
  }
  const [x, y] = project(u, -202);
  plaque(ctx, "会敵ライン", x, y - 34, "#382c47", "#ffe4a0");
}

function drawActor(ctx, actor, x, y) {
  const {card, hp, u, recoil, attack, team} = actor;
  const pose = card.poses[team];
  const scale = (compact.matches ? 1.19 : .99) + .22 * u / 1000;
  const anim = Math.floor((battle.time - actor.born) * art.fps);
  const liftProgress = recoil ? clamp((battle.time - recoil.start) / recoil.duration, 0, 1) : 0;
  const kick = recoil ? clamp(Math.abs(recoil.to - recoil.from) / 40, .4, 1.8) * Math.sin(Math.PI * liftProgress) : 0;
  const lift = 8 * kick;
  const attackTime = attack ? (attack.pausedAt ?? battle.time) - attack.start : 0;
  const frame = attack ? pose.attack[clamp(Math.floor(attackTime * art.fps), 0, pose.attack.length - 1)]
    : actor.moving && !recoil ? pose.walk[anim % pose.walk.length] : pose.idle;
  ctx.fillStyle = team === 0 ? "#855148a8" : "#524b97a8";
  ctx.strokeStyle = flags[team];
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 12 * scale, 12 * scale * art.camera.pitch, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const entrance = battle.time - actor.born;
  if (stage && entrance < .55) halo(ctx, x, y, 7 + entrance * 30, "#e3f6cf", 1.5);
  if (battle.teams[team].assaultUntil > battle.time) {
    ctx.fillStyle = "#ffdc8a";
    ctx.fillRect(Math.round(x - 3), Math.round(y + 3), 7, 2);
  }
  if (battle.time < actor.slowedUntil) {
    pathLine(ctx, [x - 9, y + 5], [x, y + 8], "#82fae4", 2);
    pathLine(ctx, [x, y + 8], [x + 9, y + 5], "#82fae4", 2);
  }
  if (recoil) {
    ctx.save();
    ctx.translate(x, y - lift);
    ctx.rotate(kick * rules.directions[team] * -.24);
    packed(ctx, frame, 0, 0, scale);
    ctx.restore();
  } else {
    packed(ctx, frame, x, y, scale);
  }
  if (hp < card.hp || attack || atLine(battle, actor)) {
    const width = 23 * scale;
    const top = y - lift - Math.min(58, pose.idle[5]) * scale + 11;
    ctx.fillStyle = "#322541";
    ctx.fillRect(x - width / 2 - 1, top - 1, width + 2, 5);
    ctx.fillStyle = "#3d3651";
    ctx.fillRect(x - width / 2, top, width, 3);
    ctx.fillStyle = flags[team];
    ctx.fillRect(x - width / 2, top, width * hp / card.hp, 3);
  }
}

function star(ctx, x, y, radius, tips, angle) {
  ctx.beginPath();
  for (let i = 0; i < tips * 2; i++) {
    const a = angle + Math.PI * i / tips;
    const r = radius * (i % 2 ? .34 : 1);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function halo(ctx, x, y, radius, color, width) {
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * .63, 0, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawHit(ctx, effect, age, example = false) {
  const style = impactStyles[effect.factor];
  const t = clamp(age / .60, 0, 1);
  const size = style.radius * (compact.matches ? 1.18 : 1) * (effect.splash ? .6 : 1);
  const entry = example ? .18 : 0;
  const [x, y] = project(effect.u, across(effect.lane), example ? 17 : 26);
  const [sx, sy] = project(effect.fromU, across(effect.fromLane), 25);
  ctx.save();
  if (t < .38 && !example && !effect.splash) {
    const partial = clamp(t * 7, 0, 1);
    const shooter = ["l", "h", "c"].includes(effect.role);
    ctx.globalAlpha = (1 - t / .38) * (shooter ? .9 : .55);
    const ax = sx + (x - sx) * partial;
    const ay = sy + (y - sy) * partial;
    pathLine(ctx, [x, y], [ax, ay], art.names[effect.type][2], shooter ? 3.5 : 2);
  }
  ctx.globalAlpha = Math.max(0, 1 - t) ** .9;
  ctx.fillStyle = style.tone;
  ctx.strokeStyle = style.edge;
  if (style.rank === 0) {
    halo(ctx, x, y, size * (1 + t), style.tone, 2);
    pathLine(ctx, [x - 6, y + 5], [x + 6, y - 5], style.edge, 2.5);
  } else if (style.rank === 1) {
    halo(ctx, x, y, size * (.8 + t), style.tone, 1.5);
    ctx.fillRect(x - 2, y - 2, 4, 4);
  } else if (style.rank === 2) {
    pathLine(ctx, [x - size * .7, y + size * .4], [x + size * .75, y - size * .45], style.edge, 5);
    pathLine(ctx, [x - size * .7, y + size * .4], [x + size * .75, y - size * .45], style.tone, 2.5);
  } else {
    halo(ctx, x, y, size * (.42 + t * 1.04), style.edge, style.rank > 3 ? 4 : 2);
    if (style.rank >= 4) halo(ctx, x, y, size * (.64 + t * 1.28), style.tone, style.rank === 5 ? 3 : 2);
    star(ctx, x, y, size * (1 - t * .78), style.rank + 1, effect.seed % 6 + entry);
    ctx.fillStyle = style.tone;
    ctx.strokeStyle = style.edge;
    ctx.lineWidth = style.rank >= 4 ? 3 : 1.7;
    ctx.stroke();
    ctx.fill();
  }
  if (style.rank > 0) {
    const count = style.rank * 3 - 1;
    for (let i = 0; i < count; i++) {
      const a = effect.seed * .73 + i * 2.4;
      const radius = size * (.48 + t * (1 + i % 5 / 3));
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius * .76;
      const piece = style.rank > 3 ? 4 - t * 2 : 2.3 - t;
      ctx.fillStyle = i % 2 ? style.tone : style.edge;
      ctx.fillRect(Math.round(px), Math.round(py), piece, piece);
    }
  }
  if (effect.slow && t < .85) halo(ctx, x, y + 10, 11 + 12 * t, "#79f3e5", 2);
  ctx.globalAlpha = clamp((1 - age / .95) * 1.4, 0, 1);
  const text = example || effect.factor === 0 ? style.name :
    "−" + effect.damage + (style.rank >= 4 ? "　×" + effect.factor : "");
  ctx.font = example ? '800 16px "Yu Gothic UI", "Meiryo", sans-serif' : '800 15px "Cascadia Mono", "Meiryo", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#30233f";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  const labelY = y - size * .52 - 5 - 30 * t;
  ctx.strokeText(text, x, labelY);
  ctx.fillStyle = style.tone;
  ctx.fillText(text, x, labelY);
  ctx.restore();
}

function render(now) {
  const ctx = worldContext;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(backdrop, 0, 0);
  drawFront(ctx);
  const actorOrder = battle.units.map(actor => {
    const join = actor.recoil || actor.attack || atLine(battle, actor) ? 1 : clamp((battle.time - actor.born) / .78, 0, 1);
    const spread = join * join * (3 - 2 * join);
    const u = actor.u + (rules.forts[actor.team] - rules.homes[actor.team]) * (1 - spread);
    const [x, y] = project(u, across(actor.lane) * spread);
    return {actor, x, y};
  });
  for (const [team, u] of rules.forts.entries()) {
    const [x, y] = project(u, 0);
    actorOrder.push({team, x, y});
  }
  actorOrder.sort((a, b) => a.y - b.y);
  for (const item of actorOrder) {
    if (item.actor) drawActor(ctx, item.actor, item.x, item.y);
    else {
      const scale = item.team === 0 ? 1.40 : 1.65;
      packed(ctx, art.forts[item.team], item.x, item.y, compact.matches ? scale * 1.13 : scale);
      const health = battle.teams[item.team].health / battle.settings.baseHealth;
      if (stage && health < .65) {
        for (let i = 0; i < (health < .3 ? 5 : 3); i++) {
          const t = (battle.time * .48 + i * .29) % 1;
          const size = Math.round(3 + t * 6);
          ctx.fillStyle = "rgba(64,61,63," + ((1 - t) * .75) + ")";
          ctx.fillRect(Math.round(item.x + 10 + i * 2 + t * 13), Math.round(item.y - 49 - t * 34), size, size);
        }
      }
      plaque(ctx, sides[item.team] + "拠点", item.x, item.y + 20, "#32263f", flags[item.team]);
    }
  }
  for (const effect of battle.effects) drawHit(ctx, effect, battle.time - effect.time);
  if (orderPulse && battle.time < orderPulse.start + 1.1) {
    const t = (battle.time - orderPulse.start) / 1.1;
    ctx.save();
    ctx.globalAlpha = .85 * (1 - t);
    const color = orderPulse.kind === "assault" ? "#ffcc84" : "#a8ffdd";
    const positions = orderPulse.kind === "assault" ? actorOrder.filter(item => item.actor?.team === 1) : [];
    const [x, y] = project(rules.forts[1], 0);
    for (const point of [{x, y}, ...positions]) halo(ctx, point.x, point.y, 9 + 39 * t, color, 3);
    ctx.restore();
  }
  if (sample) {
    const age = (now - sample.start) / 1000;
    if (age < 1) drawHit(ctx, sample, age, true);
    else sample = null;
  }
}

const deckNodes = [new Map(), new Map()];
function canSummon() {
  return battle && !loading && !guide.open && !details.open && !outcome.open &&
    !countdownRemaining && battle.winner === null;
}

function finishCommand() {
  if (stage && paused) {
    get("pause").click();
  } else {
    updateHud();
    queueFrame();
  }
}

function summon(cardId) {
  if (!canSummon() || !deploy(battle, 1, cardId)) return;
  radio.play("deploy");
  finishCommand();
}

function showAutoMode() {
  const auto = battle.teams[1].auto;
  get("auto-summon").setAttribute("aria-pressed", String(auto));
  get("auto-state").textContent = auto ? "ON" : "OFF";
}

function toggleAuto() {
  if (!canSummon()) return;
  const army = battle.teams[1];
  army.auto = !army.auto;
  army.nextCard = null;
  if (army.auto) army.nextBuy = battle.time;
  showAutoMode();
  finishCommand();
}

function fillDeck(team) {
  const list = get(team === 0 ? "enemy-deck" : "ally-deck");
  list.replaceChildren();
  deckNodes[team].clear();
  for (const card of battle.teams[team].cards) {
    const li = make("li", undefined, "card");
    const title = card.roleName + " / " + card.type.map(type => art.names[type][0]).join(" / ") +
      " / 射程 " + card.range + " / 再出撃 " + card.redeploy + "秒";
    li.title = title;
    const button = team === 1 ? make("button", undefined, "unit-card") : null;
    const panel = button ?? make("div", undefined, "unit-card");
    const wrap = make("span", undefined, "portrait");
    wrap.style.setProperty("--tint", art.names[card.type[0]][2]);
    const icon = document.createElement("canvas");
    icon.setAttribute("aria-hidden", "true");
    drawPortrait(icon, card);
    wrap.append(icon);
    const summary = make("span", undefined, "card-status");
    const type = card.type.map(code => art.names[code][0]).join("・");
    const heading = make("span", undefined, "card-head");
    heading.append(make("strong", card.name, "card-name"), make("span", card.cost, "cost"));
    const meta = make("span", undefined, "card-meta");
    meta.append(make("span", card.roleName + " Lv." + card.level), make("span", type));
    const foot = make("span", undefined, "card-foot");
    foot.append(summary);
    const copy = make("span", undefined, "card-copy");
    copy.append(heading, meta, foot);
    panel.append(wrap, copy);
    if (button) {
      const shortcut = summonKeys[allySlots.indexOf(card.id)];
      const keycap = make("kbd", "Shift+" + shortcut, "summon-key");
      keycap.setAttribute("aria-hidden", "true");
      foot.append(keycap);
      button.type = "button";
      button.setAttribute("aria-label", card.name + "を出撃　コスト" + card.cost);
      button.setAttribute("aria-keyshortcuts", "Shift+" + shortcut);
      button.addEventListener("click", () => summon(card.id));
    }
    li.append(panel);
    deckNodes[team].set(card.id, {button, summary});
    list.append(li);
  }
}

function fillPlans() {
  const ally = get("ally-plan");
  const enemy = get("enemy-plan");
  const mode = get("deploy-mode");
  if (stage) {
    get("ally-plan-label").hidden = get("enemy-plan-label").hidden = get("sandbox-custom").hidden = true;
    mode.value = "manual";
    get("mode-label").hidden = get("speed-label").hidden = true;
    return;
  }
  for (const plan of plans.values()) {
    ally.add(new Option(plan.label, plan.id));
    enemy.add(new Option(plan.label, plan.id));
  }
  if (imported) {
    plans.set(imported.id, imported);
    ally.add(new Option(imported.label, imported.id));
  }
  ally.add(new Option("カスタム編成", "custom"));
  ally.value = imported?.id ?? "starters";
  enemy.value = "gate";
  const fields = get("custom-fields");
  const selections = art.opening[1].map((id, index) => {
    const field = make("label", "枠 " + (index + 1));
    const select = document.createElement("select");
    select.add(new Option("空き枠", ""));
    for (const role of Object.keys(traits)) {
      const options = art.cards.filter(card => card.role === role);
      const group = document.createElement("optgroup");
      group.label = options[0].roleName;
      for (const card of options) {
        const types = card.type.map(code => art.names[code][0]).join("・");
        group.append(new Option(card.name + " ／ " + types, card.id));
      }
      select.append(group);
    }
    select.value = String(imported?.ids[index] ?? (imported ? "" : id));
    field.append(select);
    fields.append(field);
    return select;
  });
  const apply = make("button", "この編成で開始", "button primary");
  apply.type = "button";
  fields.append(apply);
  apply.addEventListener("click", () => {
    const ids = selections.map(select => Number(select.value)).filter(Boolean);
    const notice = get("custom-error");
    if (!ids.length || new Set(ids).size !== ids.length) {
      notice.hidden = false;
      notice.textContent = ids.length ? "同じキャラは1枠までです。" : "出撃キャラを1体以上選んでください。";
      return;
    }
    notice.hidden = true;
    plans.set("custom", {ids});
    ally.value = "custom";
    restart();
  });
  for (const control of [ally, enemy, mode]) {
    control.disabled = false;
    control.addEventListener("change", () => {
      if (control === ally && ally.value === "custom" && !plans.has("custom")) {
        ally.value = imported?.id ?? "starters";
        fields.closest("details").open = true;
        selections[0].focus();
        return;
      }
      restart();
    });
  }
}

function fillRoles() {
  for (const [role, traitsOfRole] of Object.entries(traits)) {
    const card = makeCard(art.cards.find(entry => entry.role === role));
    const row = make("tr");
    const timing = (card.impactFrames[0] / art.fps).toFixed(2) + " / " +
      (card.frames / art.fps + card.recovery).toFixed(2) + "秒（" + card.impactFrames.length + "打）";
    const columns = [card.roleName, card.hp, card.power, card.range, card.speed,
      timing, card.cost, card.redeploy + "秒", traitsOfRole.description];
    for (const [index, value] of columns.entries()) {
      const cell = make(index === 0 ? "th" : "td", value);
      if (index === 0) cell.scope = "row";
      row.append(cell);
    }
    get("roles").append(row);
  }
}

function clock(time) {
  const seconds = Math.floor(time);
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function updateHud() {
  const alive = [0, 0];
  const contact = [0, 0];
  const returning = [0, 0];
  for (const unit of battle.units) {
    alive[unit.team]++;
    if (!holdsFront(battle, unit)) continue;
    if (activeUnit(unit)) contact[unit.team]++;
    else returning[unit.team]++;
  }
  const canOrder = canSummon();
  get("auto-summon").disabled = !canOrder;
  for (const [i, key] of ["enemy", "ally"].entries()) {
    const army = battle.teams[i];
    get(key + "-cost").value = Math.floor(army.cost);
    get(key + "-hp").value = army.health + " / " + battle.settings.baseHealth;
    get(key + "-bar").value = army.health;
    get(key + "-bar").closest(".side").classList.toggle("critical", army.health > 0 && army.health <= battle.settings.baseHealth * .3);
    for (const card of army.cards) {
      const {button, summary} = deckNodes[i].get(card.id);
      const cooldown = Math.max(0, army.ready.get(card.id) - battle.time);
      const available = canOrder && i === 1 && !cooldown &&
        army.cost >= card.cost && alive[i] < battle.settings.unitLimit;
      if (button) {
        button.disabled = !available;
        button.classList.toggle("ready", available);
      }
      if (cooldown > 0) summary.textContent = "再出撃 " + cooldown.toFixed(1) + "秒";
      else if (available) summary.textContent = "出撃する";
      else if (i === 1 && countdownRemaining) summary.textContent = "開始待ち";
      else if (i === 1 && army.cost < card.cost) summary.textContent = "コスト " + Math.ceil(card.cost - army.cost) + "不足";
      else summary.textContent = "出撃 " + army.purchases.get(card.id) + "回";
    }
  }
  const {rear, splash, slowed} = battle.teams[1].stats;
  get("role-usage").textContent = "味方の後列からの命中 " + rear + " ／ 巻き込み " + splash + " ／ 減速 " + slowed;
  const finished = battle.winner !== null;
  const engaged = battle.front !== null && !finished;
  if (stage && !finished && battle.time - lastBreachAt > .8 && battle.teams.some((army, i) => army.health < lastBaseHp[i])) {
    lastBreachAt = battle.time;
    radio.play("breach");
  }
  lastBaseHp = battle.teams.map(army => army.health);
  const sieging = battle.time - lastBreachAt < 1.8;
  get("phase").textContent = finished ? "決着" : loading || countdownRemaining ? "出撃準備" : paused ? "一時停止"
    : sieging ? "攻城中" : engaged ? "会敵中" : "進軍中";
  get("phase").classList.toggle("engaged", engaged);
  get("time").textContent = drill ? "残り " + clock(Math.ceil(Math.max(0, drill.limit - activeSeconds))) : clock(battle.time);
  const frontCount = team => contact[team] + "体" + (returning[team] ? "（復帰中 " + returning[team] + "体）" : "");
  get("line-caption").textContent = engaged ? "会敵ライン固定　前列の敵 " + frontCount(0) + " ／ 味方 " + frontCount(1)
    : "会敵すると全レーンの前線が固定";
  get("army-count").textContent = "出撃中　敵 " + alive[0] + "体 ／ 味方 " + alive[1] + "体";
  get("pause").textContent = paused ? "再開" : "一時停止";
  get("pause").disabled = finished || loading;
  get("pause").setAttribute("aria-pressed", String(paused));
  const pauseKey = stage && !paused ? "Space" : "F";
  if (get("pause").getAttribute("aria-keyshortcuts") !== pauseKey) {
    get("pause").setAttribute("aria-keyshortcuts", pauseKey);
  }
  for (const [id, key] of [["assault", paused ? "A" : "1"], ["supply", paused ? "D" : "2"], ["auto-summon", paused ? ";" : "Shift+J"]]) {
    const button = get(id);
    if (button.getAttribute("aria-keyshortcuts") !== key) {
      button.setAttribute("aria-keyshortcuts", key);
      button.querySelector("kbd").textContent = key;
    }
  }
  document.body.toggleAttribute("data-key-typing", Boolean(stage && !finished && !paused));
  if (stage) get("reset").hidden = !(paused && !finished);
  if (score) {
    const ready = canOrder && score.charge === FieldOrders.fullCharge;
    const army = battle.teams[1];
    const orderActive = army.assaultUntil > battle.time;
    get("assault").disabled = !ready || orderActive;
    get("supply").disabled = !ready || (army.health >= battle.settings.baseHealth && army.cost >= battle.settings.costLimit);
    get("type-console").classList.toggle("charged", score.charge === FieldOrders.fullCharge);
    get("assault").classList.toggle("active-order", orderActive);
    get("assault").lastElementChild.textContent = orderActive ? "発令中　残り" + Math.ceil(army.assaultUntil - battle.time) + "秒" : "6秒間 威力×1.5";
    get("field-message").hidden = !messageUntil || battle.time >= messageUntil;
    get("touch-board").classList.toggle("inactive", paused || !canOrder);
  }
  get("show-outcome").hidden = !finished;
  if (finished && !resultShown) showResult();

  if (eventHead !== battle.events[0]) {
    eventHead = battle.events[0];
    get("events").replaceChildren(...battle.events.slice(0, 5).map(info => {
      const entry = make("li", undefined, info.team === 0 ? "enemy-event" : info.team === 1 ? "ally-event" : "");
      entry.append(make("time", clock(info.time)), make("span", info.text));
      return entry;
    }));
  }
  if (lastInHud !== battle.lastHit) {
    lastInHud = battle.lastHit;
    if (!lastInHud) get("last-hit").textContent = "会敵すると最新の一撃がここに表示されます。";
    else {
      const {attacker, victim, factor, damage, type} = lastInHud;
      get("last-hit").replaceChildren(
        make("b", impactStyles[factor].name + "　×" + factor + "　" + damage + " ダメージ"),
        make("br"), document.createTextNode(attacker + " → " + victim + "（" + art.names[type][0] + "）"));
    }
  }
}

function queueFrame() {
  if (!frameRequest) frameRequest = requestAnimationFrame(tick);
}

function campaignLinks() {
  get("battle-map").href = get("result-map").href = session.href(session.mapFile);
  get("battle-formation").href = get("result-team").href = session.href("formation-demo.html");
  if (drill) {
    get("result-map").href = session.href("../index.html");
    get("result-map").textContent = "作戦本部へ";
  }
}

function showExerciseScore(won, stats) {
  const damage = 1 - battle.teams[0].health / battle.settings.baseHealth;
  const typingPoints = Math.min(500, score.words * 10) + (score.words ? stats.accuracy * 2 : 0);
  const clearBonus = won ? 3000 + Math.floor(Math.max(0, drill.limit - activeSeconds) * 25) : 0;
  const points = Math.round(3000 * damage) + typingPoints + clearBonus;
  const saved = session.state.exercise;
  const prior = saved?.day === drill.day ? saved : {best: 0, won: false};
  const best = Math.max(prior.best, points);
  if (!saved || saved.day <= drill.day) session.state.exercise = {day: drill.day, best, won: won || prior.won};
  get("winner").textContent = won ? "演習成功" : timeout ? "時間切れ" : "演習終了";
  get("result-kind").textContent = drill.day.replaceAll("-", ".");
  get("result-medals").append(make("strong", points.toLocaleString("ja-JP") + " 点"), make("span",
    (points > prior.best ? "自己ベスト更新　" : "本日のベスト　") + best.toLocaleString("ja-JP") + " 点"));
  if (!won) get("result-advice").textContent = "敵拠点へのダメージも得点になります。今日は同じ貸与部隊とお題で再挑戦できます。";
}

let joinFrame = 0;
function showRecruit(card) {
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  get("join-origin").textContent = stage.name + "　制圧報酬";
  get("join-name").textContent = card.name;
  get("join-description").textContent = traits[card.role].description + "。";
  const labels = card.type.map(code => {
    const [name, ink, fill] = art.names[code];
    const tag = make("span", name);
    tag.style.background = fill;
    tag.style.color = ink;
    return tag;
  });
  get("join-tags").replaceChildren(make("span", card.roleName), ...labels);
  reveal.style.setProperty("--type-glow", art.names[card.type[0]][2]);
  get("join-team").href = session.href("formation-demo.html", stage.id, {unit: card.id});
  const sparks = get("join-sparks");
  sparks.replaceChildren();
  if (motion) for (let i = 0; i < 40; i++) {
    const particle = make("i");
    const angle = Math.PI * 2 * i / 40;
    const radius = 60 + (i * 31 + card.id) % 108;
    particle.style.setProperty("--x", Math.round(Math.cos(angle) * radius * 1.6) + "px");
    particle.style.setProperty("--y", Math.round(Math.sin(angle) * radius) + "px");
    particle.style.setProperty("--size", (i % 4 === 0 ? 14 : 4 + i % 5) + "px");
    particle.style.setProperty("--delay", (.64 + i % 6 * .045) + "s");
    sparks.append(particle);
  }
  reveal.showModal();
  radio.play("recruit");
  const canvas = get("join-actor");
  const ctx = canvas.getContext("2d");
  const pose = card.poses[0];
  const frames = [card.portrait, pose.idle, ...pose.walk, ...pose.attack];
  const scale = Math.min(3.4, ...frames.map(([, , w, h, , floor]) =>
    Math.min(178 / w, 117 / floor, 22 / Math.max(1, h - floor))));
  const start = performance.now();
  const arrival = .72;
  const end = arrival + card.frames / art.fps;
  function draw(now) {
    const t = motion ? Math.max(0, now - start) / 1000 : end;
    const arriving = t < arrival;
    const showingMove = t >= arrival && t < end;
    const frame = arriving ? pose.walk[Math.floor(t * art.fps) % pose.walk.length]
      : showingMove ? pose.attack[Math.min(pose.attack.length - 1, Math.floor((t - arrival) * art.fps))] : card.portrait;
    const progress = Math.min(1, t / arrival);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.filter = t < .40 ? "brightness(.32)" : t < .78 ? "brightness(1.22)" : "none";
    packed(ctx, frame, 100 - 63 * (1 - progress) ** 2, 123 - Math.sin(progress * Math.PI) * 8, scale);
    if (reveal.open && t < end) joinFrame = requestAnimationFrame(draw);
  }
  draw(start);
}
function openOutcome() {
  outcome.showModal();
  const action = get("result-next").hidden ? get(drill ? "result-map" : "again") : get("result-next");
  action.focus();
}
reveal.addEventListener("close", () => {
  cancelAnimationFrame(joinFrame);
  if (resultShown && !outcome.open) openOutcome();
});

function recordCampaignBattle(won, stats) {
  const progress = session.state;
  const front = session.front;
  const seen = battle.teams[0].cards.filter(card => battle.teams[0].purchases.get(card.id) > 0).map(card => card.id);
  progress.seen = [...new Set([...progress.seen, ...seen])];
  if (!won) return;
  const previous = front.records[stage.id] ?? {};
  front.records[stage.id] = {
    kpm: Math.max(stats.kpm, previous.kpm ?? 0), accuracy: Math.max(stats.accuracy, previous.accuracy ?? 0),
    precision: Boolean(stats.precision || previous.precision), command: Boolean(stats.command || previous.command),
  };
  for (const [name, earned] of [["制圧", true], ["精密", stats.precision], ["指揮", stats.command]]) {
    const badge = make("span", (earned ? "◆ " : "◇ ") + name, earned ? "earned" : "unearned");
    badge.setAttribute("aria-label", name + (earned ? " 獲得" : " 未達成"));
    get("result-medals").append(badge);
  }
  progress.experience += stage.xp;
  get("result-xp").textContent = "+" + stage.xp.toLocaleString("ja-JP") + " XP";
  const first = !front.cleared.includes(stage.id);
  get("result-kind").textContent = first ? "初回攻略" : "再攻略";
  if (first) front.cleared.push(stage.id);
  if (first && !progress.members.includes(stage.recruit)) {
    progress.members.push(stage.recruit);
    const recruit = cardsById.get(stage.recruit);
    get("recruit-name").textContent = recruit.name;
    drawPortrait(get("recruit-portrait"), recruit);
    get("result-join").hidden = false;
  }
  const pending = frontStages.find(entry => !front.cleared.includes(entry.id));
  let next = frontStages[stage.frontNumber] ?? pending;
  get("result-next").hidden = false;
  if (!pending && (first || stage.frontNumber === frontStages.length)) {
    outcome.classList.add("final-clear");
    if (session.country === "japan") {
      next = art.stages.find(entry => entry.country === "usa" && !progress.usa.cleared.includes(entry.id))
        ?? art.stages.find(entry => entry.country === "usa");
      get("winner").textContent = "日本戦線・全拠点制圧";
      get("result-advice").textContent = first ? "アメリカ戦線が解放されました。育てた部隊でメイン州から50州の攻略に挑めます。"
        : "日本の全47拠点を制圧しました。アメリカ戦線にも出撃できます。";
    } else {
      next = null;
      get("winner").textContent = "日米全97拠点制圧";
      get("result-advice").textContent = "アメリカ全50州を制圧しました。両戦線に再出撃して、残る勲章を獲得できます。";
    }
  }
  get("result-next").textContent = !next ? "作戦本部へ" : next.country === session.country ? next.name + "へ" : "アメリカ戦線へ";
  return next;
}

function showResult() {
  resultShown = true;
  const won = battle.winner === 1;
  outcome.classList.remove("final-clear");
  outcome.dataset.win = String(won);
  get("winner").textContent = stage ? (won ? "攻略完了" : "敗北") : sides[battle.winner] + "の勝利";
  get("result-stage").textContent = stage?.name ?? "草丘の関所";
  get("result-time").textContent = clock(stage ? activeSeconds : battle.time);
  get("result-ally-hp").textContent = battle.teams[1].health;
  get("result-enemy-hp").textContent = battle.teams[0].health;
  get("result-reward").hidden = !(stage && !drill && won);
  get("result-join").hidden = true;
  get("result-next").hidden = true;
  get("result-team").textContent = won ? "編成・育成" : "編成を見直す";
  get("result-team").hidden = Boolean(drill);
  get("result-kind").textContent = "";
  if (stage) {
    session.sync();
    const stats = FieldOrders.metrics(score, activeSeconds);
    get("typing-result").hidden = false;
    get("result-accuracy").textContent = score.correct || score.misses ? stats.accuracy + "%" : "—";
    get("result-kpm").textContent = stats.kpm + " 打/分";
    get("result-chain").textContent = score.longest + " 語";
    get("result-advice").textContent = won ? "完了 " + score.words + "語　／　発令 " + score.orders + "回"
      : !score.orders ? "3語をノーミスで打つと号令を使えます。補給で味方拠点のHPを回復できます。"
      : "前衛を支える防壁や、敵のタイプに強い仲間を組み込んで再挑戦できます。";
    get("result-medals").replaceChildren();
    let next;
    if (drill) showExerciseScore(won, stats);
    else next = recordCampaignBattle(won, stats);
    session.save();
    campaignLinks();
    if (!get("result-next").hidden) {
      get("result-next").href = next ? session.href(next.country + "-stage-map.html", next.id, {country: next.country}) : session.href("../index.html");
    }
  }
  if (details.open) details.close();
  if (get("result-join").hidden) {
    openOutcome();
    radio.play(won ? "victory" : "defeat");
  } else {
    showRecruit(cardsById.get(stage.recruit));
  }
}

function setPrompt([word, reading]) {
  typingEngine = new RomajiEngine(reading);
  get("typing-word").textContent = word;
  get("typing-reading").textContent = reading === word ? "" : reading;
}

function showPrompt(message, fault = false) {
  const guide = typingEngine.guide;
  get("typed").textContent = typingEngine.typedText;
  get("next-key").textContent = guide[0] ?? "";
  get("type-tail").textContent = guide.slice(1);
  get("type-feedback").textContent = message;
  get("type-console").classList.toggle("fault", fault);
  get("chain").textContent = score.chain + " 語連続";
  const charge = score.charge;
  get("charge-text").textContent = charge === FieldOrders.fullCharge ? "発令可能" : charge + " / 6";
  get("charge-meter").setAttribute("aria-valuenow", charge);
  [...get("charge-meter").children].forEach((pip, i) => pip.classList.toggle("on", i < charge));
  lastTouchHint?.classList.remove("next");
  lastTouchHint = get("touch-board").querySelector('[data-letter="' + (guide[0] ?? "") + '"]');
  lastTouchHint?.classList.add("next");
}

function receiveLetter(letter) {
  if (!typingEngine || paused || !canSummon()) return;
  const previousCharge = score.charge;
  const result = typingEngine.step(letter);
  FieldOrders.strike(score, result);
  if (!result.accepted) {
    showPrompt("次は「" + result.guide[0] + "」", true);
    radio.play("miss");
    return;
  }
  const army = battle.teams[1];
  const before = army.cost;
  army.cost = Math.min(battle.settings.costLimit, before + 18);
  const gain = Math.floor(army.cost - before);
  let message = gain ? "出撃コスト ＋" + gain : "コスト上限";
  let cue = "key";
  if (result.completed) {
    setPrompt(promptDeck.next());
    message = score.chain ? "ノーミス達成" : "指令完了";
    cue = "word";
    if (score.charge > previousCharge) message += "　指揮 ＋" + (score.charge - previousCharge);
    if (score.charge === FieldOrders.fullCharge && previousCharge < score.charge) {
      message = "指揮ゲージ満タン";
      cue = "ready";
    }
  }
  radio.play(cue);
  showPrompt(message);
  updateHud();
}

function fieldMessage(text) {
  get("field-message").textContent = text;
  get("field-message").hidden = false;
  messageUntil = battle.time + 2.5;
}

function issueOrder(kind) {
  if (!score || !canSummon() || score.charge < FieldOrders.fullCharge || get(kind).disabled) return;
  const army = battle.teams[1];
  score.orders++;
  score.charge = 0;
  let message;
  if (kind === "assault") {
    army.assaultUntil = battle.time + 6;
    message = "総攻撃！　味方の威力 ×1.5";
  } else {
    army.health = Math.min(battle.settings.baseHealth, army.health + 120);
    army.cost = Math.min(battle.settings.costLimit, army.cost + 90);
    message = "補給到着　拠点修復・コスト補充";
  }
  orderPulse = {start: battle.time, kind};
  radio.play(kind);
  fieldMessage(message);
  recordEvent(battle, message, 1);
  showPrompt(message);
  finishCommand();
}
for (const kind of ["assault", "supply"]) get(kind).addEventListener("click", () => issueOrder(kind));

function showTouchKeys() {
  get("toggle-keys").hidden = !stage;
  get("toggle-keys").setAttribute("aria-pressed", String(touchVisible));
  get("touch-board").hidden = !stage || !touchVisible;
  document.body.classList.toggle("with-keyboard", Boolean(stage && touchVisible));
}
function setTouchKeys(value) {
  touchVisible = value;
  session.sync();
  if (session.state.touchKeys !== value) {
    session.state.touchKeys = value;
    session.save();
    campaignLinks();
  }
  showTouchKeys();
}
if (stage) {
  for (const letters of ["qwertyuiop", "asdfghjkl-", "zxcvbnm'"]) {
    const row = make("div");
    for (const key of letters) {
      const button = make("button", key.toUpperCase());
      button.type = "button";
      button.dataset.letter = key;
      button.setAttribute("aria-label", "キー " + key.toUpperCase());
      row.append(button);
    }
    get("touch-board").append(row);
  }
  get("touch-board").addEventListener("click", event => {
    const key = event.target.closest("button")?.dataset.letter;
    if (key) receiveLetter(key);
  });
  get("toggle-keys").addEventListener("click", () => setTouchKeys(!touchVisible));
}

document.addEventListener("keydown", event => {
  if (!battle || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.repeat ||
      document.querySelector("dialog[open]") || event.target.matches?.("select, input, textarea")) return;
  if (event.key === "Escape" && !get("pause").disabled) {
    event.preventDefault();
    get("pause").click();
    return;
  }
  if (!canSummon()) return;
  if (event.shiftKey) {
    const key = event.code.startsWith("Key") ? event.code.slice(3) : event.key.toUpperCase();
    const slot = summonKeys.indexOf(key);
    if (key === "J" || slot !== -1) {
      event.preventDefault();
      if (key === "J") toggleAuto();
      else if (allySlots[slot]) summon(allySlots[slot]);
      return;
    }
  }
  if (paused || !typingEngine) return;
  if (event.key === "1" || event.key === "2") {
    event.preventDefault();
    issueOrder(event.key === "1" ? "assault" : "supply");
    return;
  }
  let letter = event.key;
  if (event.isComposing || letter === "Process" || letter === "Unidentified") {
    letter = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : {Minus: "-", Quote: "'"}[event.code] ?? "";
  }
  if (!/^[a-z'-]$/i.test(letter)) return;
  event.preventDefault();
  receiveLetter(letter);
});

function showCountdown() {
  const countdown = get("countdown");
  countdown.hidden = !(countdownRemaining || paused && stage) || guide.open || details.open || loading;
  countdown.classList.toggle("is-paused", paused);
  if (!countdown.hidden) {
    const number = get("count-number");
    const seconds = paused ? "一時停止" : String(Math.ceil(countdownRemaining));
    if (number.value !== seconds) number.value = seconds;
  }
}

function tick(now) {
  frameRequest = 0;
  if (!battle) return;
  const delta = priorTime ? (now - priorTime) / 1000 : 0;
  const elapsed = Math.min(.25, delta);
  priorTime = now;
  if (!paused && !guide.open && !details.open && !loading && battle.winner === null) {
    if (countdownRemaining) {
      countdownRemaining = Math.max(0, countdownRemaining - delta);
      showCountdown();
      if (!countdownRemaining) {
        recordEvent(battle, stage.name + "で進軍開始");
        radio.play("start");
        updateHud();
      }
    } else {
      const playable = drill ? Math.min(delta, Math.max(0, drill.limit - activeSeconds)) : delta;
      activeSeconds += playable;
      accumulator += Math.min(elapsed, playable) * Number(get("speed").value);
      while (accumulator >= step && battle.winner === null) {
        stepBattle(battle, step);
        accumulator -= step;
      }
      if (bossReserve && battle.winner === null && battle.teams[0].health <= battle.settings.baseHealth / 2) {
        bossReserve = false;
        const enemy = battle.teams[0];
        enemy.cost = Math.min(battle.settings.costLimit, enemy.cost + 140);
        enemy.ready.set(enemy.cards[0].id, battle.time);
        enemy.nextCard = enemy.cards[0].id;
        enemy.nextBuy = battle.time;
        fieldMessage("敵拠点から増援！　守備隊が反撃");
        recordEvent(battle, "敵の増援が到着", 0);
        radio.play("ready");
      }
      if (drill && activeSeconds >= drill.limit && battle.winner === null) {
        timeout = true;
        battle.winner = 0;
      }
    }
  }
  sinceHud += elapsed;
  if (sinceHud > .095 || battle.winner !== null) {
    sinceHud = 0;
    updateHud();
  }
  render(now);
  if ((!paused && !guide.open && !details.open && !loading && battle.winner === null) || sample) queueFrame();
  else priorTime = 0;
}

async function restart(opening = false) {
  const id = ++restartId;
  const ally = drill ? plans.get(drill.ally) : stage ? {ids: session.state.slots.filter(id => cardsById.has(id)), levels: session.state.levels} :
    plans.get(get("ally-plan").value);
  const enemy = stage ? {ids: stage.enemies.map(unit => unit.id),
    levels: Object.fromEntries(stage.enemies.map(unit => [unit.id, unit.level]))} : plans.get(get("enemy-plan").value);
  const autoDemo = !stage && get("deploy-mode").value === "auto";
  loading = true;
  if (stage) document.body.setAttribute("data-key-typing", "");
  get("pause").disabled = true;
  showCountdown();
  if (outcome.open) outcome.close();
  get("show-outcome").hidden = true;
  get("phase").textContent = "準備中";
  try {
    await Promise.all([...new Set([0, ...ally.ids, ...enemy.ids])].map(loadAtlas));
  } catch {
    if (id === restartId) {
      loading = false;
      document.body.removeAttribute("data-key-typing");
      get("phase").textContent = "素材の読み込みに失敗";
      get("reset").disabled = false;
      get("reset").hidden = false;
    }
    return;
  }
  if (id !== restartId) return;
  loading = false;
  resultShown = false;
  const typing = Boolean(stage) && !autoDemo;
  countdownRemaining = stage ? 3 : 0;
  allySlots = stage && !drill ? session.state.slots : ally.ids;
  battleSeed = drill?.seed ?? (stage ? Math.floor(Math.random() * 0x100000000) : initialSeed);
  battle = createBattle(art, battleSeed, {
    decks: [enemy.ids, ally.ids], levels: [enemy.levels, ally.levels], auto: [true, autoDemo || typing],
    settings: typing ? {teamIncome: [drill ? 14 : Math.min(14, 9 + stage.number), 0]} : undefined,
  });
  if (typing) {
    battle.teams[1].cost = 0;
    battle.teams[0].cost = drill ? 180 : Math.min(450, 25 + 20 * stage.number);
  }
  fillDeck(0);
  fillDeck(1);
  showAutoMode();
  get("type-console").hidden = !typing;
  typingEngine = null;
  score = typing ? FieldOrders.scorecard() : null;
  activeSeconds = 0;
  timeout = false;
  bossReserve = Boolean(stage?.boss);
  orderPulse = null;
  lastBreachAt = -Infinity;
  lastBaseHp = [battle.settings.baseHealth, battle.settings.baseHealth];
  messageUntil = 0;
  get("field-message").hidden = true;
  if (typing) {
    promptDeck = FieldOrders.deck(stage, cardsById.get(enemy.ids[0]).role, battleSeed);
    setPrompt(promptDeck.first);
    showPrompt("");
    showTouchKeys();
  }
  get("income").textContent = typing ? "タイピングで増加" : "+" + rules.income + " / 秒";
  get("enemy-deck-label").textContent = "敵の編成　" + enemy.ids.length + "体";
  if (!stage) recordEvent(battle, "草丘の関所で進軍開始");
  if (opening && !stage && !imported) for (let i = 0; i < 384; i++) stepBattle(battle, step);
  paused = opening && !stage && matchMedia("(prefers-reduced-motion: reduce)").matches;
  sample = null;
  accumulator = 0;
  priorTime = 0;
  if (opening && stage && !session.state.battleGuide && !guide.open) guide.showModal();
  showCountdown();
  get("reset").disabled = false;
  updateHud();
  queueFrame();
}

get("pause").addEventListener("click", () => {
  paused = !paused;
  priorTime = 0;
  showCountdown();
  updateHud();
  queueFrame();
});
get("reset").addEventListener("click", () => restart());
get("auto-summon").addEventListener("click", toggleAuto);
get("again").addEventListener("click", () => restart());
get("show-outcome").addEventListener("click", openOutcome);
get("show-battle-details").addEventListener("click", () => { details.showModal(); priorTime = 0; showCountdown(); });
details.addEventListener("close", () => { priorTime = 0; showCountdown(); queueFrame(); });
get("show-battle-guide").addEventListener("click", () => {
  guide.showModal();
  showCountdown();
});
for (const [id, touch] of [["guide-auto", true], ["guide-type", false]]) get(id).addEventListener("click", () => {
  setTouchKeys(touch);
  guide.close();
});
guide.addEventListener("close", () => {
  session.sync();
  if (!session.state.battleGuide) {
    session.state.battleGuide = true;
    session.save();
    campaignLinks();
  }
  priorTime = 0;
  showCountdown();
  queueFrame();
});
const detailTabs = details.querySelectorAll(".detail-tabs button");
const volume = get("battle-volume");
volume.value = String(Math.round((session?.state.volume ?? .6) * 100));
volume.addEventListener("input", () => radio.setVolume(Number(volume.value) / 100));
volume.addEventListener("change", () => {
  if (session) {
    session.sync();
    session.state.volume = Number(volume.value) / 100;
    session.save();
    campaignLinks();
  }
  radio.play("word");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stage && battle && battle.winner === null && !loading && !guide.open && !details.open) {
    paused = true;
    priorTime = 0;
    showCountdown();
    updateHud();
  }
});
for (const tab of detailTabs) tab.addEventListener("click", () => {
  for (const button of detailTabs) {
    button.setAttribute("aria-pressed", String(button === tab));
    get(button.getAttribute("aria-controls")).hidden = button !== tab;
  }
});
compact.addEventListener("change", () => {
  makeBackdrop();
  if (battle) queueFrame();
});
for (const factor of [.25, .5, 1, 2, 4, 0]) {
  const button = make("button", undefined, "impact");
  button.type = "button";
  button.disabled = true;
  const icon = make("i");
  icon.style.setProperty("--trace", impactStyles[factor].tone);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, document.createTextNode("×" + factor + "　" + impactStyles[factor].name));
  button.addEventListener("click", () => {
    details.close();
    sample = {factor, u: battle.front ?? 500, lane: 4.5, type: "N", seed: 73, start: performance.now()};
    queueFrame();
  });
  get("impact-buttons").append(button);
}

makeBackdrop();
worldContext.drawImage(backdrop, 0, 0);
if (stage) {
  document.body.classList.add("live-front");
  const position = get("guide-position");
  position.value = session.state.guidePosition;
  document.body.classList.toggle("field-prompt", position.value === "field");
  get("guide-position-label").hidden = false;
  position.addEventListener("change", () => {
    session.sync();
    session.state.guidePosition = position.value;
    document.body.classList.toggle("field-prompt", position.value === "field");
    session.save();
    campaignLinks();
  });
  document.title = stage.name + "｜打鍵戦線";
  get("battle-title").textContent = stage.name;
  get("battle-subtitle").textContent = drill ? "日替わり演習 ／ 貸与部隊 Lv.1・90秒"
    : (session.country === "usa" ? "アメリカ " : "") + "第" + String(stage.frontNumber).padStart(2, "0") + "拠点　／　" + stage.region + (stage.boss ? "　地方ボス・半壊で増援" : "");
  if (drill) get("battle-guide-title").textContent = "演習指令　90秒で敵拠点を制圧";
  if (stage.boss) get("battle-guide-title").textContent = "地方ボス戦　敵拠点の半壊で増援";
  showTouchKeys();
  get("show-battle-guide").hidden = false;
  campaignLinks();
}
fillPlans();
fillRoles();
get("enemy-bar").max = get("ally-bar").max = rules.baseHealth;
restart(true).then(() => {
  for (const button of get("impact-buttons").children) button.disabled = !battle;
});
