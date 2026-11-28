"use strict";

const japanStageCount = 47;
const campaignLevels = {
  japan: {firstEnemy: 1, lastEnemy: 20, allyCap: 30},
  usa: {firstEnemy: 21, lastEnemy: 40, allyCap: 50},
};

function usaUnlocked(progress) {
  const cleared = new Set(progress?.cleared);
  for (let id = 1; id <= japanStageCount; id++) if (!cleared.has(id)) return false;
  return true;
}

function allyLevelCap(progress) {
  return campaignLevels[usaUnlocked(progress) ? "usa" : "japan"].allyCap;
}

function allyLevel(trainedLevel, cap) {
  return Number.isSafeInteger(trainedLevel) && trainedLevel > 0 ? Math.min(trainedLevel, cap) : 1;
}

function enemyLevelLabel(average) {
  return "敵平均 Lv." + average.toLocaleString("ja-JP", {maximumFractionDigits: 1});
}

function campaignCountry() {
  const selected = document.body.dataset.country ?? new URLSearchParams(location.search).get("country");
  return selected === "usa" ? "usa" : "japan";
}

function campaignFront(progress) {
  const country = usaUnlocked(progress) ? "usa" : "japan";
  const stages = commandData.stages.filter(stage => stage.country === country);
  const saved = country === "usa" ? progress?.usa : progress;
  const cleared = Array.isArray(saved?.cleared) ? saved.cleared : [];
  const nextBase = stages.find(stage => !cleared.includes(stage.id)) ?? stages.at(-1);
  return {country, stages, nextBase};
}

function campaignStages({prefectures, areas = prefectures, regions, gates, starters}, country = "japan") {
  const names = new Map(areas.map(({id, name}) => [id, name]));
  const recruits = new Map(gates.map(({id, guard}) => [id, guard.id]));
  const stages = regions.flatMap(({name: region, ids}) => ids.map((id, index) => ({
    id, name: names.get(id), region, boss: index === ids.length - 1, recruit: recruits.get(id),
  })));
  const {firstEnemy, lastEnemy} = campaignLevels[country];
  return stages.map((stage, index) => {
    const number = index + 1 + (country === "usa" ? japanStageCount : 0);
    const guards = stages.slice(Math.max(0, index - 4), index + 1).map(entry => entry.recruit).reverse();
    const ids = country === "usa" && guards.length < 5 ? guards.concat(starters.slice(0, 5 - guards.length).map(unit => unit.id)) : guards;
    const target = firstEnemy + (lastEnemy - firstEnemy) * index / Math.max(1, stages.length - 1);
    const total = Math.round(target * ids.length);
    const base = Math.floor(total / ids.length);
    const extra = total % ids.length;
    return {
      ...stage, country, number, frontNumber: index + 1, averageEnemyLevel: total / ids.length,
      xp: 220 + (number - 1) * 30 + (stage.boss ? 90 : 0),
      enemies: ids.map((id, slot) => ({id, level: base + (slot < extra ? 1 : 0)})),
    };
  });
}

function stageAvailable(stages, id, cleared) {
  const index = stages.findIndex(stage => stage.id === id);
  return index === 0 || index > 0 && (cleared.includes(id) || cleared.includes(stages[index - 1].id));
}

function openCampaign(starters = []) {
  const player = GamePlayers.active;
  if (!player) return null;
  const url = new URL(location.href);
  const country = campaignCountry();
  const stageId = Number(url.searchParams.get("stage"));
  const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
  const list = (value, max) => Array.isArray(value) ? [...new Set(value.filter(id => positive(id, max)))] : [];
  const integer = (value, max) => positive(value, max) ? value : 0;

  function readFront(saved, ids) {
    const cleared = Array.isArray(saved?.cleared) ? [...new Set(saved.cleared.filter(id => ids.has(id)))] : [];
    const records = {};
    for (const id of cleared) {
      const record = saved.records?.[id];
      if (record) records[id] = {precision: record.precision === true, command: record.command === true,
        kpm: integer(record.kpm, 99999), accuracy: integer(record.accuracy, 100)};
    }
    return {cleared, records};
  }
  const frontIds = {japan: new Set(), usa: new Set()};
  for (const stage of commandData.stages) frontIds[stage.country].add(stage.id);
  function parse(saved) {
    try {
      if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 0) return null;
      const members = [...new Set([...starters, ...list(saved.members, 200)])];
      const assigned = new Set();
      const slots = Array.from({length: 5}, (_, index) => {
        const id = saved.slots?.[index];
        if (!members.includes(id) || assigned.has(id)) return null;
        assigned.add(id);
        return id;
      });
      const exercise = saved.exercise;
      return {
        revision: saved.revision, members, slots, ...readFront(saved, frontIds.japan), usa: readFront(saved.usa, frontIds.usa),
        seen: list(saved.seen, 200), experience: positive(saved.experience, 1e9) ? saved.experience : 0,
        levels: Object.fromEntries(members.filter(id => positive(saved.levels?.[id], 999))
          .map(id => [id, saved.levels[id]])),
        mapGuide: saved.mapGuide === true, battleGuide: saved.battleGuide === true,
        volume: Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : .6,
        touchKeys: typeof saved.touchKeys === "boolean" ? saved.touchKeys : null,
        guidePosition: saved.guidePosition === "side" ? "side" : "field",
        exercise: /^\d{4}-\d{2}-\d{2}$/.test(exercise?.day) ? {
          day: exercise.day, best: integer(exercise.best, 1e7), won: exercise.won === true,
        } : null,
      };
    } catch {
      return null;
    }
  }

  const name = GamePlayers.get(player).name;
  function readStored() {
    return parse(GamePlayers.get(player)?.progress);
  }
  const stored = readStored();
  const state = stored ?? {
    revision: 0, members: [...starters], slots: [...starters], cleared: [], seen: [],
    levels: {}, experience: 0, mapGuide: false, battleGuide: false, records: {}, usa: {cleared: [], records: {}},
    volume: .6, touchKeys: null, guidePosition: "field", exercise: null,
  };

  function persist() {
    GamePlayers.put(player, {name, progress: state});
  }
  if (!stored && state.members.length) persist();
  function sync() {
    const newest = readStored();
    if (!newest || newest.revision <= state.revision) return false;
    Object.assign(state, newest);
    return true;
  }
  function save() {
    state.revision++;
    persist();
    GamePlayers.tag(url.searchParams, player, {name, progress: state});
    try { history.replaceState(history.state, "", url); } catch { /* Links carry the new state. */ }
  }

  function href(target, id = stageId, extra = {}, hash = "") {
    const {country: destination = country, ...options} = extra;
    const params = new URLSearchParams({stage: id, ...options});
    if (destination === "usa") params.set("country", "usa");
    GamePlayers.tag(params, player, {name, progress: state});
    if (destination === country && !params.has("view") && id === stageId && url.searchParams.has("view")) params.set("view", url.searchParams.get("view"));
    return target + "?" + params + hash;
  }

  const home = document.querySelector("[data-command-home]");
  if (home && state.members.length) {
    const syncHome = () => { home.href = href("../index.html"); };
    syncHome();
    home.addEventListener("click", syncHome);
  }
  return {stageId, country, mapFile: country + "-stage-map.html", get front() { return country === "usa" ? state.usa : state; }, state, save, sync, href};
}

if (typeof module !== "undefined") module.exports = {campaignStages, stageAvailable, allyLevelCap, allyLevel};
