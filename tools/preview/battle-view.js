"use strict";

const art = JSON.parse(document.querySelector("#battle-art").textContent);
const get = id => document.getElementById(id);
const field = get("field");
const worldContext = field.getContext("2d");
const backdrop = document.createElement("canvas");
const atlas = new Image();
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
let scene;
let battle;
let paused = false;
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

function makeBackdrop() {
  scene = compact.matches
    ? {width: 880, height: 460, scale: .78, middle: 226}
    : {width: 1280, height: 535, scale: 1.12, middle: 258};
  field.width = backdrop.width = scene.width;
  field.height = backdrop.height = scene.height;
  const ctx = backdrop.getContext("2d");
  const {width, height} = scene;
  const ground = ctx.createLinearGradient(0, 0, width, height);
  ground.addColorStop(0, "#323653");
  ground.addColorStop(.55, "#252941");
  ground.addColorStop(1, "#211e34");
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
  grass.addColorStop(0, "#9ba778");
  grass.addColorStop(.50, "#a6b286");
  grass.addColorStop(1, "#8fa88b");
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
}

function packed(ctx, frame, x, y, scale = 1) {
  const [sx, sy, w, h, ox, oy] = frame;
  ctx.drawImage(atlas, sx, sy, w, h, Math.round(x - ox * scale), Math.round(y - oy * scale),
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
      plaque(ctx, sides[item.team] + "拠点", item.x, item.y + 20, "#32263f", flags[item.team]);
    }
  }
  for (const effect of battle.effects) drawHit(ctx, effect, battle.time - effect.time);
  if (sample) {
    const age = (now - sample.start) / 1000;
    if (age < 1) drawHit(ctx, sample, age, true);
    else sample = null;
  }
}

const deckNodes = [new Map(), new Map()];
function fillDeck(team) {
  const list = get(team === 0 ? "enemy-deck" : "ally-deck");
  list.replaceChildren();
  deckNodes[team].clear();
  for (const card of battle.teams[team].cards) {
    const li = make("li", undefined, "card");
    const title = card.roleName + " / " + card.type.map(type => art.names[type][0]).join(" / ") +
      " / 射程 " + card.range + " / 再出撃 " + card.redeploy + "秒";
    li.title = title;
    const button = team === 1 && !battle.teams[team].auto ? make("button", undefined, "unit-card") : null;
    const panel = button ?? make("div", undefined, "unit-card");
    const wrap = make("span", undefined, "portrait");
    wrap.style.setProperty("--tint", art.names[card.type[0]][2]);
    const icon = document.createElement("canvas");
    const [x, y, w, h] = card.portrait;
    icon.width = w;
    icon.height = h;
    icon.setAttribute("aria-hidden", "true");
    icon.getContext("2d").drawImage(atlas, x, y, w, h, 0, 0, w, h);
    wrap.append(icon);
    const summary = make("span", undefined, "card-status");
    const type = card.type.map(code => art.names[code][0]).join("・");
    panel.append(wrap, make("span", card.cost, "cost"), make("strong", card.name),
      make("span", card.roleName + " / Lv." + card.level, "card-role"),
      make("span", type, "card-role"), summary);
    if (button) {
      button.type = "button";
      button.setAttribute("aria-label", card.name + "を出撃　コスト" + card.cost);
      button.addEventListener("click", () => {
        if (deploy(battle, team, card.id)) {
          updateHud();
          queueFrame();
        }
      });
    }
    li.append(panel);
    deckNodes[team].set(card.id, {button, summary});
    list.append(li);
  }
}

function fillPlans() {
  const ally = get("ally-plan");
  const enemy = get("enemy-plan");
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
  for (const control of [ally, enemy, get("deploy-mode")]) {
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
    const columns = [card.roleName, card.hp, card.power, card.range, card.speed,
      card.recovery + "秒", card.cost, card.redeploy + "秒", traitsOfRole.description];
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
  for (const [i, key] of ["enemy", "ally"].entries()) {
    const army = battle.teams[i];
    get(key + "-cost").value = Math.floor(army.cost);
    get(key + "-hp").value = army.health + " / " + battle.settings.baseHealth;
    get(key + "-bar").value = army.health;
    for (const card of army.cards) {
      const {button, summary} = deckNodes[i].get(card.id);
      const cooldown = Math.max(0, army.ready.get(card.id) - battle.time);
      const available = battle.winner === null && !army.auto && i === 1 && !cooldown &&
        army.cost >= card.cost && alive[i] < battle.settings.unitLimit;
      if (button) {
        button.disabled = !available;
        button.classList.toggle("ready", available);
      }
      if (cooldown > 0) summary.textContent = "再出撃 " + cooldown.toFixed(1) + "秒";
      else if (available) summary.textContent = "出撃する";
      else if (i === 1 && !army.auto && army.cost < card.cost) summary.textContent = "コスト " + Math.ceil(card.cost - army.cost) + "不足";
      else summary.textContent = "出撃 " + army.purchases.get(card.id) + "回";
    }
  }
  const {rear, splash, slowed} = battle.teams[1].stats;
  get("role-usage").textContent = "味方の後列からの命中 " + rear + " ／ 巻き込み " + splash + " ／ 減速 " + slowed;
  const finished = battle.winner !== null;
  const engaged = battle.front !== null && !finished;
  get("phase").textContent = finished ? "決着" : paused ? "一時停止" : engaged ? "会敵中" : "進軍中";
  get("phase").classList.toggle("engaged", engaged);
  get("time").textContent = clock(battle.time);
  const frontCount = team => contact[team] + "体" + (returning[team] ? "（復帰中 " + returning[team] + "体）" : "");
  get("line-caption").textContent = engaged ? "会敵ライン固定　前列の敵 " + frontCount(0) + " ／ 味方 " + frontCount(1)
    : "会敵すると全レーンの前線が固定";
  get("army-count").textContent = "出撃中　敵 " + alive[0] + "体 ／ 味方 " + alive[1] + "体";
  get("pause").textContent = paused ? "再開" : "一時停止";
  get("pause").disabled = finished;
  get("outcome").hidden = !finished;
  if (finished) get("winner").textContent = sides[battle.winner] + "の勝利";

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

function tick(now) {
  frameRequest = 0;
  const elapsed = priorTime ? Math.min(.064, (now - priorTime) / 1000) : 0;
  priorTime = now;
  if (!paused && battle.winner === null) {
    accumulator += elapsed * Number(get("speed").value);
    while (accumulator >= step) {
      stepBattle(battle, step);
      accumulator -= step;
    }
  }
  sinceHud += elapsed;
  if (sinceHud > .095 || battle.winner !== null) {
    sinceHud = 0;
    updateHud();
  }
  render(now);
  if ((!paused && battle.winner === null) || sample) queueFrame();
  else priorTime = 0;
}

function restart(opening = false) {
  const ally = plans.get(get("ally-plan").value);
  const enemy = plans.get(get("enemy-plan").value);
  const auto = get("deploy-mode").value === "auto";
  battle = createBattle(art, initialSeed, {decks: [enemy.ids, ally.ids], levels: [{}, ally.levels], auto: [true, auto]});
  fillDeck(0);
  fillDeck(1);
  get("deploy-title").textContent = auto ? "味方の自動出撃" : "味方の手動出撃";
  get("enemy-deck-label").textContent = "敵の編成　" + enemy.ids.length + "体";
  recordEvent(battle, "草丘の関所で進軍開始");
  if (opening && !imported) for (let i = 0; i < 384; i++) stepBattle(battle, step);
  paused = opening && matchMedia("(prefers-reduced-motion: reduce)").matches;
  sample = null;
  accumulator = 0;
  priorTime = 0;
  updateHud();
  queueFrame();
}

get("pause").addEventListener("click", () => {
  paused = !paused;
  priorTime = 0;
  updateHud();
  queueFrame();
});
get("reset").addEventListener("click", () => restart());
get("again").addEventListener("click", () => restart());
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
    sample = {factor, u: battle.front ?? 500, lane: 4.5, type: "N", seed: 73, start: performance.now()};
    queueFrame();
  });
  get("impact-buttons").append(button);
}

makeBackdrop();
worldContext.drawImage(backdrop, 0, 0);
atlas.src = art.atlas;
atlas.decode().then(() => {
  fillPlans();
  fillRoles();
  get("enemy-bar").max = get("ally-bar").max = rules.baseHealth;
  get("income").textContent = "+" + rules.income + " / 秒";
  get("reset").disabled = false;
  for (const button of get("impact-buttons").children) button.disabled = false;
  restart(true);
}, () => {
  get("phase").textContent = "素材の読み込みに失敗";
});
