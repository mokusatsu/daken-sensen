const assert = require("node:assert/strict");
const {readFile, writeFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {root, preview, readJapanRoster, withPreviewPage, renderTemplate, inlineJson} = require("./browser.cjs");
const camera = {pitch: .44, heading: 309};

async function main() {
  const [{starters, rewards}, rosterHtml, template, engine, view] = await Promise.all([
    readJapanRoster(),
    readFile(resolve(preview, "character-roster.html"), "utf8"),
    readFile(resolve(__dirname, "battle.template.html"), "utf8"),
    readFile(resolve(root, "tools/battle-engine.cjs"), "utf8"),
    readFile(resolve(__dirname, "battle-view.js"), "utf8"),
  ]);
  const battleRoster = rosterHtml.replace(/^const pitch = [\d.]+;$/m, "const pitch = " + camera.pitch + ";");
  assert.notEqual(battleRoster, rosterHtml, "図鑑の投影設定を確認してください");
  const data = await withPreviewPage("battle", async page => {
    await page.setContent(battleRoster, {waitUntil: "domcontentloaded"});
    return page.evaluate(({starters, recruits, camera}) => {
      if (pitch !== camera.pitch) throw new Error("戦場の投影設定が適用されていません");
      const headingFor = team => (camera.heading + team * 180) % 360;
      const representatives = Object.fromEntries(Object.keys(roles).map(role =>
        [role, units.filter(unit => unit.role === role).slice(0, 2).map(unit => unit.id)]));
      const opening = [[107, 69, 99, 2, 41], starters];
      const presets = [
        {id: "starters", label: "初期編成", ids: starters},
        {id: "gate", label: "草丘の守備隊", ids: opening[0]},
        {id: "rush", label: "速攻・連打", ids: [141, 23, 11, 9, 16]},
        {id: "guard", label: "防壁・狙撃", ids: [41, 1, 13, 7, 69]},
        {id: "area", label: "範囲・妨害", ids: [141, 3, 70, 54, 23]},
        {id: "siege", label: "重前衛・大技", ids: [141, 3, 18, 19, 16]},
      ];
      const ids = [...new Set([...presets.flatMap(entry => entry.ids), ...recruits, ...Object.values(representatives).flat()])];
      const costumes = ids.map(id => units.find(unit => unit.id === id));
      if (costumes.some(unit => !unit)) throw new Error("図鑑のIDを確認してください");
      const total = costumes.reduce((sum, unit) => sum + 2 * (walkCycles[unit.travel].length + attackCycles[unit.role][1].length + 1) + 1, 2);
      const sheet = document.createElement("canvas");
      const scratch = document.createElement("canvas");
      const cell = 124;
      const columns = 12;
      sheet.width = cell * columns;
      sheet.height = Math.ceil(total / columns) * cell;
      const ctx = sheet.getContext("2d");
      let slot = 0;

      function pack(pose, heading) {
        drawStack(scratch, pose, heading);
        if (scratch.width >= cell || scratch.height >= cell) throw new Error("アトラスの枠が小さすぎます");
        const x = slot % columns * cell;
        const y = Math.floor(slot / columns) * cell;
        ctx.drawImage(scratch, x, y);
        slot++;
        return [x, y, scratch.width, scratch.height, pose.frameHalf, pose.floor];
      }

      const cards = costumes.map(unit => {
        const clips = bakeClips(unit);
        const [roleName, ratings] = roles[unit.role];
        const profile = attackCycles[unit.role][1];
        return {
          id: unit.id, name: unit.name, type: unit.type, role: unit.role, roleName, ratings, frames: profile.length,
          impactFrames: profile.flatMap((pose, frame) => pose[3] === 1 ? [frame] : []),
          portrait: pack(spriteFor(unit), 337),
          poses: [0, 1].map(team => ({
            idle: pack(clips.idle[0], headingFor(team)),
            walk: clips.walk.map(frame => pack(frame, headingFor(team))),
            attack: clips.attack.map(frame => pack(frame, headingFor(team))),
          })),
        };
      });
      const forts = [
        "b 0 0 5 28 23 5 3 deep;b 0 0 12 26 20 4 3 slate;b 0 1 22 20 16 11 3 clay;b 0 14 19 8 5 10 2 ink;b 0 16 12 7 5 3 1 red;k 18 -8 29 8 9 18 red;k 18 -8 44 9 9 4 sun;b 0 -2 33 12 9 8 3 red;b 0 -2 43 12 9 3 2 tea;l -2 -3 40 -2 -3 57 1.7 slate;b 4 -3 55 7 2 4 1 gold;k 18 2 22 4 5 4 gold",
        "b 0 0 5 29 22 5 3 deep;b 0 0 12 26 20 4 3 slate;b 0 1 22 20 16 11 3 iv;b 0 14 20 8 5 10 2 plum;b 0 16 12 8 5 3 1 lil;k 18 -8 28 8 9 17 ash;t -18 -8 40 10 10 3 .91 plum;t 18 -8 40 10 10 3 .91 lil;b 0 -4 34 12 8 9 3 lil;b 0 -4 44 13 9 3 2 plum;l 2 -4 43 2 -4 58 1.7 deep;b 8 -4 56 7 2 4 1 sea;k 18 2 24 3 4 5 sky",
      ].map((recipe, team) => pack(sculpt(recipe), headingFor(team)));
      const names = Object.fromEntries(typeCodes.map(code => [code, types[code].slice(0, 3)]));
      const matchups = Object.fromEntries(typeCodes.map(code => [code,
        Object.fromEntries(typeCodes.map(defender => [defender, multiplier(code, [defender])]))]));
      return {opening, presets, cards, forts, names, matchups, camera, fps: motionFps, atlas: sheet.toDataURL("image/png")};
    }, {
      camera, starters, recruits: rewards.map(reward => reward.id),
    });
  });
  assert.deepEqual(data.opening.map(army => army.length), [5, 5]);
  assert.equal(new Set(data.cards.map(card => card.role)).size, 10);
  assert(data.cards.every(card => card.poses.every(pose => pose.walk.length === 6 &&
    pose.attack.length === card.frames) && card.frames <= 24 && card.impactFrames.length));
  const html = renderTemplate(template, {ART: inlineJson(data), SIMULATION: engine.trimEnd(), VIEW: view.trimEnd()});
  await writeFile(resolve(preview, "battle-demo.html"), html);
  console.log("バトルデモ", data.cards.length, "体");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
