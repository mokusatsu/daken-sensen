"use strict";

function campaignStages({prefectures, areas = prefectures, regions, gates}) {
  const names = new Map(areas.map(({id, name}) => [id, name]));
  const recruits = new Map(gates.map(({id, guard}) => [id, guard.id]));
  const stages = regions.flatMap(({name: region, ids}) => ids.map((id, index) => ({
    id, name: names.get(id), region, boss: index === ids.length - 1, recruit: recruits.get(id),
  })));
  return stages.map((stage, index) => {
    const ids = stages.slice(Math.max(0, index - 4), index + 1).map(entry => entry.recruit).reverse();
    return {
      ...stage, number: index + 1, xp: 120 + index * 15 + (stage.boss ? 80 : 0),
      enemies: ids.map((id, slot) => ({id, level: 1 + Math.floor((index + (slot ? 0 : 1)) / 4)})),
    };
  });
}

function stageAvailable(stages, id, cleared) {
  const index = stages.findIndex(stage => stage.id === id);
  return index === 0 || index > 0 && (cleared.includes(id) || cleared.includes(stages[index - 1].id));
}

function openCampaign(starters = []) {
  const key = "typing-war.japan-preview.v1";
  const url = new URL(location.href);
  const stageId = Number(url.searchParams.get("stage"));
  const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
  const list = (value, max) => Array.isArray(value) ? [...new Set(value.filter(id => positive(id, max)))] : [];

  function parse(raw) {
    try {
      const saved = JSON.parse(raw);
      if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 0) return null;
      const members = [...new Set([...starters, ...list(saved.members, 200)])];
      const assigned = new Set();
      const slots = Array.from({length: 5}, (_, index) => {
        const id = saved.slots?.[index];
        if (!members.includes(id) || assigned.has(id)) return null;
        assigned.add(id);
        return id;
      });
      return {
        revision: saved.revision, members, slots, cleared: list(saved.cleared, 47),
        seen: list(saved.seen, 200), experience: positive(saved.experience, 1e9) ? saved.experience : 0,
        levels: Object.fromEntries(members.filter(id => positive(saved.levels?.[id], 999))
          .map(id => [id, saved.levels[id]])),
        mapGuide: saved.mapGuide === true, battleGuide: saved.battleGuide === true,
      };
    } catch {
      return null;
    }
  }

  const passed = parse(url.searchParams.get("play"));
  let stored;
  try { stored = parse(localStorage.getItem(key)); } catch { /* The links also carry progress. */ }
  const state = stored && (!passed || stored.revision >= passed.revision) ? stored : passed ?? {
    revision: 0, members: [...starters], slots: [...starters], cleared: [], seen: [],
    levels: {}, experience: 0, mapGuide: false, battleGuide: false,
  };

  function save() {
    state.revision++;
    const raw = JSON.stringify(state);
    try { localStorage.setItem(key, raw); } catch { /* The links also carry progress. */ }
    url.searchParams.set("play", raw);
    try { history.replaceState(history.state, "", url); } catch { /* Links carry the new state. */ }
  }

  function href(target, id = stageId, extra = {}, hash = "") {
    const params = new URLSearchParams({stage: id, play: JSON.stringify(state), ...extra});
    if (!params.has("view") && id === stageId && url.searchParams.has("view")) params.set("view", url.searchParams.get("view"));
    return target + "?" + params + hash;
  }

  return {stageId, state, save, href};
}

if (typeof module !== "undefined") module.exports = {campaignStages, stageAvailable};
