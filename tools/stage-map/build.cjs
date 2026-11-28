const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {mkdir, readFile, writeFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {pathToFileURL} = require("node:url");
const {parseArgs} = require("node:util");
const configs = require("./maps.json");
const {prepareGeometry} = require("./geometry.cjs");
const {bake} = require("./bake.cjs");

const root = resolve(__dirname, "../..");
const preview = resolve(root, "preview");
const loadJson = async file => JSON.parse(await readFile(file, "utf8"));
const escapeHtml = text => String(text).replace(/[&<>"]/g, char =>
  ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[char]);
const mapFile = id => id + "-stage-map.html";

function markup(country, config, template, assets) {
  const mapNav = Object.entries(configs).map(([id, definition]) => {
    const current = country === id ? ' aria-current="page"' : "";
    return '<a href="' + mapFile(id) + '"' + current + ">" + escapeHtml(definition.navTitle) + "</a>";
  }).join("");
  const credits = [
    ["境界の原典　" + config.boundary.name, config.boundary.url],
    ["境界データの配布元", config.boundary.intermediate],
    ["標高の原典　" + config.elevation.name, config.elevation.url],
  ].filter(([, url]) => url).map(([label, url]) => '<a href="' + escapeHtml(url) + '">' + escapeHtml(label) + "</a>").join("\n    ");
  const description = config.areaName + "の境界と主な島を簡略化し、標高は" +
    config.projection.elevationStepMetres + "m刻みで段差を強調しています。" +
    (config.regions.some(region => region.inset) ? " アラスカとハワイは別縮尺です。" : "");
  const replacements = {
    COUNTRY: country,
    TITLE: escapeHtml(config.title),
    AREA: escapeHtml(config.areaName),
    MAP_NAV: mapNav,
    MAP_DESCRIPTION: escapeHtml(description),
    CREDITS: credits,
    COUNT: assets.areas.length,
    MAP_ASSETS: JSON.stringify(assets).replace(/</g, "\\u003c"),
  };
  return template.replace(/%%([A-Z_]+)%%/g, (token, name) => {
    assert(Object.hasOwn(replacements, name), "Unknown template field " + token);
    return replacements[name];
  });
}

async function reservedGuards(config) {
  if (!config.excludeAtlas) return [];
  const reference = await readFile(resolve(preview, config.excludeAtlas), "utf8");
  const embedded = reference.match(/<script id="map-assets" type="application\/json">([\s\S]*?)<\/script>/);
  assert(embedded, "門番の参照データを読み込めません " + config.excludeAtlas);
  return JSON.parse(embedded[1]).gates.map(({guard}) => guard.id);
}

async function main() {
  const {positionals, values} = parseArgs({
    allowPositionals: true,
    options: {"out-dir": {type: "string"}, python: {type: "string"}, playwright: {type: "string"}, browser: {type: "string"}},
  });
  const [country] = positionals;
  if (positionals.length !== 1 || !Object.hasOwn(configs, country)) {
    throw new Error("使い方: node tools/stage-map/build.cjs japan|usa");
  }
  const config = configs[country];
  const output = resolve(values["out-dir"] ?? preview);
  const work = resolve(root, ".codex-temp/stage-maps", country);
  const playwright = values.playwright ? resolve(values.playwright) : require.resolve("playwright", {
    paths: [resolve(root, ".codex-temp/stage-map-runtime"), __dirname],
  });
  const executablePath = values.browser ? resolve(values.browser) : undefined;
  const {chromium} = require(playwright);
  const runSources = command => {
    execFileSync(values.python ?? "python", ["-B", resolve(__dirname, "sources.py"), country, command],
      {cwd: root, stdio: "inherit"});
  };
  runSources("boundaries");
  const borders = await loadJson(resolve(work, "boundaries.json"));
  const geometry = prepareGeometry(config, borders.shapes);
  assert(geometry.areas.some(area => area.id === config.initialStage));
  await writeFile(resolve(work, "geometry.json"), JSON.stringify(geometry));
  runSources("elevation");
  const dem = await loadJson(resolve(work, "elevations.json"));
  const excludedIds = await reservedGuards(config);
  const template = await readFile(resolve(__dirname, "map.template.html"), "utf8");

  process.chdir(work);
  const context = await chromium.launchPersistentContext(resolve(work, "chromium-profile"), {
    executablePath, artifactsDir: work, headless: true, offline: true, viewport: {width: 1200, height: 820},
  });
  let result;
  try {
    const page = context.pages()[0];
    await page.goto(pathToFileURL(resolve(preview, "character-roster.html")).href);
    result = await bake(page, {
      ...geometry, seedNumber: config.seed, starterIds: config.starterIds, excludedIds, elevations: dem.images,
    });
  } finally {
    await context.close();
  }
  const {regions, projection, areas} = geometry;
  const guards = new Set(result.gates.map(entry => entry.guard.id));
  assert.equal(guards.size, areas.length);
  assert([...config.starterIds, ...excludedIds].every(id => !guards.has(id)));
  const land = result.sheets.reduce((sum, {land}) => sum + land, 0);
  const missing = result.sheets.reduce((sum, {missing}) => sum + missing, 0);
  console.log("標高の取得率", (100 * (1 - missing / land)).toFixed(2) + "%");
  for (const [index, item] of result.sheets.entries()) {
    assert(item.land > 0 && item.maxBand > 0, regions[index].name + " の標高層がありません");
    console.log(regions[index].name, "最高層", item.maxBand, "未取得セル", item.missing + "/" + item.land);
  }
  assert(land && missing / land < .035, "標高サンプルの未取得率が3.5%を超えています");
  const source = {...config.boundary, sha256: borders.sha256};
  const elevationSource = {...config.elevation, sha256: dem.sha256};
  const areaCodeKey = country === "japan" ? "prefectureCodes" : "areaCodes";
  const manifest = {
    source, elevationSource, projection,
    packing: "PNGは足元から上面へ左から順に並ぶ。sliceSizeごとに切り出し、地方ごとのworldOriginで重ねる。",
    regions: regions.map(({id, name, ids, origin, size, inset, focus}) => ({
      name, file: id + ".png", [areaCodeKey]: ids, worldOrigin: origin, sliceSize: size,
      ...(inset ? {inset: true, viewBounds: focus} : {}),
    })),
  };
  const assets = {
    projection, gates: result.gates, starters: result.starters, guardAtlas: result.guardAtlas,
    initialStage: config.initialStage, regionOrder: config.regionOrder,
    areas: areas.map(({id, name, anchor}) => ({id, name, anchor})),
    regions: regions.map(({id, name, ids, origin, size, focus, inset}, i) => {
      const {sheet, index, maxBand} = result.sheets[i];
      return {id, name, ids, origin, size, focus, inset, sheet, index, maxBand};
    }),
  };
  const folder = resolve(output, country + "-map-sprites");
  await mkdir(folder, {recursive: true});
  await Promise.all(regions.map(({id}, i) =>
    writeFile(resolve(folder, id + ".png"), Buffer.from(result.sheets[i].sheet.split(",")[1], "base64"))));
  await writeFile(resolve(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(resolve(output, mapFile(country)), markup(country, config, template, assets));
  console.log(config.title, areas.length + "面", regions.length + "組の積層PNG", resolve(output, mapFile(country)));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {markup};
