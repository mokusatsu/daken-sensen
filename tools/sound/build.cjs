"use strict";

const {execFileSync} = require("node:child_process");
const {mkdirSync, readFileSync, writeFileSync} = require("node:fs");
const {homedir} = require("node:os");
const {resolve, join} = require("node:path");

const root = resolve(__dirname, "../..");
const studio = resolve(process.argv[2] || join(homedir(), ".agents", "skills", "lumina-sfx"));
const dest = join(root, "preview/media/sfx");
const work = join(root, ".codex-temp/sound");
mkdirSync(dest, {recursive: true});
mkdirSync(work, {recursive: true});

const cues = {
  key: ["gasket-mount-keyboard-key-down", "--speed", "1.4", "--pitchShift=-2"],
  miss: ["menu-blocked-double-tap"],
  word: ["menu-confirm-pluck", "--pitchShift", "3"],
  ready: ["coin-pickup-chime", "--speed", ".85"],
  assault: ["arcade-kill-confirm-padded-bass-punch"],
  breach: ["checkpoint-gate-stamped-shut", "--speed", "1.3"],
  supply: ["energy-shield-block", "--pitchShift", "4"],
  deploy: ["menu-tab-snap"],
  start: ["checkpoint-save-cue"],
  defeat: ["flight-radar-contact-lost", "--speed", ".8", "--pitchShift=-4"],
};
const victory = {
  id: "victory", layers: [0, 4, 7].map((interval, index) => ({
    id: index === 2 ? "coin-pickup-chime" : "menu-confirm-pluck",
    offsetSec: index * .105, gain: [.70, .78, .90][index], macros: {pitchShift: interval},
  })),
};
const recruit = {
  id: "recruit",
  layers: [
    {id: "scoreboard-flag-lift", offsetSec: 0, gain: .58},
    {id: "menu-confirm-pluck", offsetSec: .24, gain: .75, macros: {pitchShift: 3}},
    {id: "menu-confirm-pluck", offsetSec: .45, gain: .82, macros: {pitchShift: 7}},
    {id: "coin-pickup-chime", offsetSec: .72, gain: .92, macros: {pitchShift: 12, speed: .68}},
  ],
  macros: {space: "hallway", wetness: .23},
};
const recipes = Object.entries(cues).map(([name, args]) => [name, [...args, "--id", name]]);
for (const scene of [victory, recruit]) {
  const spec = join(work, scene.id + ".json");
  writeFileSync(spec, JSON.stringify(scene));
  recipes.push([scene.id, ["--spec", spec]]);
}
const sounds = {};
const files = recipes.map(([name, args]) => {
  const json = execFileSync(process.execPath, ["scripts/remix.mjs", ...args, "--format", "wav", "--dest", work],
    {cwd: studio, encoding: "utf8"});
  const {pass, sha256, credits} = JSON.parse(json);
  if (!pass) throw new Error("音声を書き出せませんでした " + name);
  console.log(name + ".wav");
  sounds[name] = readFileSync(join(work, name + ".wav")).toString("base64");
  return {cue: name, sha256, credits};
});
// Classic scripts also load when the game is opened directly from disk.
writeFileSync(join(dest, "bank.js"), "const fieldSounds = " + JSON.stringify(sounds) + ";\n");
writeFileSync(join(dest, "credits.json"), JSON.stringify({library: "Lumina SFX", files}, null, 2) + "\n");
