const assert = require("node:assert/strict");
const {mkdir, readFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {parseArgs} = require("node:util");

const root = resolve(__dirname, "../..");
const preview = resolve(root, "preview");

async function readJapanRoster() {
  const html = await readFile(resolve(preview, "japan-stage-map.html"), "utf8");
  const embedded = html.match(/<script id="map-assets" type="application\/json">([\s\S]*?)<\/script>/);
  assert(embedded, "日本マップの編成データが見つかりません");
  const map = JSON.parse(embedded[1]);
  const areas = map.areas ?? map.prefectures;
  return {
    starters: map.starters.map(guard => guard.id),
    rewards: map.regions.flatMap(region => region.ids).slice(0, 4).map(id => ({
      id: map.gates.find(gate => gate.id === id).guard.id,
      place: areas.find(area => area.id === id).name,
    })),
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
module.exports = {root, preview, readJapanRoster, withPreviewPage, renderTemplate, inlineJson};
