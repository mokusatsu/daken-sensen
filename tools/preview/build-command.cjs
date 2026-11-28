"use strict";

const {access, writeFile, mkdir} = require("node:fs/promises");
const {join} = require("node:path");
const {preview, readCampaignMaps} = require("./browser.cjs");
const scenery = require("./scenery.json");

async function build() {
  const maps = await readCampaignMaps();
  const stages = maps.flatMap(map => map.stages.map(({id, name, number, region, boss, country, frontNumber}) => {
    const location = scenery[country][id];
    if (!location) throw new Error(name + "の背景が登録されていません");
    const [landmark, image = "scenery/" + country + "/" + id + ".webp"] = location;
    return {id, name, number, region, boss, country, frontNumber, landmark, image};
  }));
  await Promise.all(stages.map(stage => access(join(preview, "media", stage.image))));
  const roster = maps.flatMap(({country, assets}) => {
    const guards = assets.gates.map(({guard}) => guard);
    if (country === "japan") guards.unshift(...assets.starters);
    return guards.map(({id, name, role, frame}) => ({id, name, country, role, frame}));
  });
  const data = {stages, roster, starters: maps[0].assets.starters.map(({id}) => id)};
  await mkdir(join(preview, "media"), {recursive: true});
  for (const {country, assets} of maps) {
    const file = country === "japan" ? "units.png" : "units-usa.png";
    await writeFile(join(preview, "media", file), Buffer.from(assets.guardAtlas.split(",")[1], "base64"));
  }
  await writeFile(join(preview, "command-data.js"), "const commandData = " + JSON.stringify(data) + ";\n");
}
build().catch(error => { console.error(error); process.exitCode = 1; });
