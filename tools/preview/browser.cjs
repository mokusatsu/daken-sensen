const assert = require("node:assert/strict");
const {mkdir, readFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {parseArgs} = require("node:util");
const {campaignStages} = require("../../preview/campaign.js");

const root = resolve(__dirname, "../..");
const preview = resolve(root, "preview");

async function readCampaignMaps() {
  return Promise.all(["japan", "usa"].map(async country => {
    const html = await readFile(resolve(preview, country + "-stage-map.html"), "utf8");
    const embedded = html.match(/<script id="map-assets" type="application\/json">([\s\S]*?)<\/script>/);
    assert(embedded, country + " の編成データが見つかりません");
    const assets = JSON.parse(embedded[1]);
    return {country, assets, stages: campaignStages(assets, country)};
  }));
}

async function readCampaignRoster() {
  const maps = await readCampaignMaps();
  const stages = maps.flatMap(map => map.stages);
  return {
    starters: maps[0].assets.starters.map(guard => guard.id),
    stages,
    rewards: stages.map(({recruit: id, name: place}) => ({id, place})),
  };
}

async function withPreviewPage(name, run) {
  const {values} = parseArgs({options: {playwright: {type: "string"}, browser: {type: "string"}}});
  const playwright = values.playwright ? resolve(values.playwright) : require.resolve("playwright", {
    paths: [resolve(root, ".codex-temp/stage-map-runtime"), __dirname],
  });
  const executablePath = values.browser ? resolve(values.browser) : undefined;
  const {chromium} = require(playwright);
  const work = resolve(root, ".codex-temp/preview");
  await mkdir(work, {recursive: true});
  process.chdir(work);
  const context = await chromium.launchPersistentContext(resolve(work, name + "-profile"), {
    executablePath, artifactsDir: work, headless: true, offline: true,
  });
  try {
    return await run(context.pages()[0]);
  } finally {
    await context.close();
  }
}

function renderTemplate(template, fields) {
  return template.replace(/%%([A-Z_]+)%%/g, (token, name) => {
    assert(Object.hasOwn(fields, name), "不明な埋め込み項目 " + token);
    return fields[name];
  });
}

const inlineJson = value => JSON.stringify(value).replace(/</g, "\\u003c");
module.exports = {root, preview, readCampaignMaps, readCampaignRoster, withPreviewPage, renderTemplate, inlineJson};
