"use strict";

const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const {balance, createBattle, stepBattle, rules} = require("./battle-engine.cjs");

const limit = 105;
const seeds = [43, 731, 1789, 6089, 20129, 51971, 69031, 90239];
const validationSeeds = [239, 1103, 2377, 8009, 10247, 43891, 68219, 90121];
const formations = [
  ["速攻", "mrsuu"],
  ["防壁・狙撃", "wmlub"],
  ["範囲・妨害", "mwacr"],
  ["重前衛・大技", "mwbhc"],
  ["均衡", "mwsau"],
];

function readData(path = resolve(__dirname, "../preview/battle-demo.html")) {
  const source = readFileSync(path, "utf8");
  const payload = source.match(/<script id="battle-art" type="application\/json">([^<]+)<\/script>/);
  return JSON.parse(payload ? payload[1] : source);
}

function neutralData(data) {
  return {...data, matchups: Object.fromEntries(Object.keys(data.matchups).map(type => [
    type, Object.fromEntries(Object.keys(data.matchups).map(defense => [defense, 1])),
  ]))};
}

function deckFor(data, roles) {
  const taken = new Set();
  return [...roles].map(role => {
    const card = data.cards.find(entry => entry.role === role && !taken.has(entry.id));
    if (!card) throw new Error("役割の候補が不足しています " + role);
    taken.add(card.id);
    return card.id;
  });
}

function simulate(data, decks, seed, settings, tuning = balance) {
  const battle = createBattle(data, seed, {decks, settings, tuning, trace: false});
  const frames = Math.ceil(limit / rules.step);
  for (let tick = 0; tick < frames && battle.winner === null; tick++) stepBattle(battle);
  return battle;
}

function blank() {
  return {w: 0, l: 0, undecided: 0, damage: 0, hpDiff: 0, splash: 0, slowed: 0, rear: 0, times: []};
}

function add(result, battle, side) {
  const army = battle.teams[side];
  result.damage += army.stats.damage;
  result.hpDiff += army.health - battle.teams[1 - side].health;
  result.splash += army.stats.splash;
  result.slowed += army.stats.slowed;
  result.rear += army.stats.rear;
  if (battle.winner === null) result.undecided++;
  else {
    if (battle.winner === side) result.w++;
    else result.l++;
    result.times.push(battle.time);
  }
}

function compare(data, a, b, {tuning = balance, sample = seeds, settings} = {}) {
  const scores = [blank(), blank()];
  for (const seed of sample) {
    const left = simulate(data, [a, b], seed, settings, tuning);
    const right = simulate(data, [b, a], seed, settings, tuning);
    add(scores[0], left, 0);
    add(scores[0], right, 1);
    add(scores[1], left, 1);
    add(scores[1], right, 0);
  }
  return scores;
}

function paired(data, a, b, options) {
  return compare(data, a, b, options)[0];
}

function compact(score) {
  const count = score.w + score.l + score.undecided;
  const times = [...score.times].sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
  return {
    win: score.w, loss: score.l, undecided: score.undecided,
    score: Number(((score.w + .5 * score.undecided) / count * 100).toFixed(1)),
    median: times.length ? Number(median.toFixed(1)) : null,
    hp: Math.round(score.hpDiff / count), damage: Math.round(score.damage / count),
    splash: Number((score.splash / count).toFixed(1)),
    slowed: Number((score.slowed / count).toFixed(1)),
    rear: Number((score.rear / count).toFixed(1)),
  };
}

function tournament(data, entries, options = {}) {
  const rows = Object.fromEntries(entries.map(([label]) => [label, blank()]));
  const headToHead = [];
  for (const [i, [a, deckA]] of entries.entries()) {
    for (const [b, deckB] of entries.slice(i + 1)) {
      const [first, second] = compare(data, deckA, deckB, options);
      for (const [name, score] of [[a, first], [b, second]]) {
        const row = rows[name];
        for (const key of Object.keys(row)) {
          if (key === "times") row.times.push(...score.times);
          else row[key] += score[key];
        }
      }
      headToHead.push({a, b, ...compact(first)});
    }
  }
  return {rows: Object.fromEntries(Object.entries(rows).map(([name, value]) => [name, compact(value)])), headToHead};
}

function main() {
  const args = process.argv.slice(2);
  const validation = args.includes("--validation");
  const sample = validation ? validationSeeds : seeds;
  const data = readData(args.find(arg => arg !== "--validation"));
  const neutral = neutralData(data);
  const entries = formations.map(([label, roles]) => [label, deckFor(data, roles)]);
  console.log("等倍での編成比較");
  const equal = tournament(neutral, entries, {sample});
  console.table(equal.rows);
  console.table(equal.headToHead.map(({a, b, win, loss, undecided, median}) => ({a, b, win, loss, undecided, median})));
  console.log("実際のタイプ相性でのプリセット比較");
  const typed = tournament(data, data.presets.map(({label, ids}) => [label, ids]), {sample});
  console.table(typed.rows);
  console.log("各戦闘は最長 " + limit + " 秒、" + sample.length + " シードで敵味方を交代。");
  if (validation) return;
  console.log("1枠を入れ替えたときの勝敗（等倍、各セルは勝・敗・未決着）");
  const core = "mwra";
  const columns = entries.filter(([label]) => ["速攻", "防壁・狙撃", "重前衛・大技"].includes(label));
  const roles = Object.fromEntries(data.cards.map(card => [card.role, card.roleName]));
  console.table(Object.fromEntries(Object.entries(roles).map(([role, label]) => {
    const deck = deckFor(data, core + role);
    return [label, Object.fromEntries(columns.map(([opponent, opposing]) => {
      const score = paired(neutral, deck, opposing, {sample});
      return [opponent, [score.w, score.l, score.undecided].join(" / ")];
    }))];
  })));
}

if (require.main === module) main();
module.exports = {readData, neutralData, deckFor, simulate, paired, compact, tournament, formations, seeds};
