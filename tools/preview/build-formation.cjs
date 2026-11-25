const assert = require("node:assert/strict");
const {readFile, writeFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {pathToFileURL} = require("node:url");
const {makeCard} = require("../battle-engine.cjs");
const {preview, readJapanRoster, withPreviewPage, renderTemplate, inlineJson} = require("./browser.cjs");

async function build() {
  const [{starters, rewards}, template] = await Promise.all([
    readJapanRoster(),
    readFile(resolve(__dirname, "formation.template.html"), "utf8"),
  ]);
  assert.equal(new Set([...starters, ...rewards.map(reward => reward.id)]).size, 9);

  const {data, renderer} = await withPreviewPage("formation", async page => {
    await page.goto(pathToFileURL(resolve(preview, "character-roster.html")).href);
    return page.evaluate(({starters, rewards}) => {
      const sprites = document.createElement("canvas");
      const cards = [...starters, ...rewards.map(reward => reward.id)].map(id => {
        const unit = units.find(candidate => candidate.id === id);
        const [role, ratings] = roles[unit.role];
        const {depth, prow, radii, data: voxels, ...stack} = spriteFor(unit);
        drawStack(sprites, {...stack, radii, data: voxels}, 334);
        return {
          id, name: unit.name, role, flavor: unit.flavor,
          types: unit.type.map(type => types[type].slice(0, 3)),
          ratings,
          portrait: sprites.toDataURL("image/png"),
          stack: {...stack, radii: Array.from(radii), data: btoa(Array.from(voxels, cell => String.fromCharCode(cell)).join(""))},
          source: rewards.find(reward => reward.id === id)?.place ?? "",
        };
      });
      return {
        data: {starters, cards, experience: 420, stackRender: {pitch, pixelColors, outerInk, shadowInk}},
        renderer: drawStack.toString(),
      };
    }, {starters, rewards});
  });
  assert(data.cards.every(card => card.portrait.startsWith("data:image/png;base64,") && card.stack.data));
  data.cards = data.cards.map(({ratings, ...card}) => {
    const {hp, power, cost} = makeCard({ratings});
    return {...card, hp, power, cost};
  });
  const output = renderTemplate(template, {FORMATION_DATA: inlineJson(data), STACK_RENDERER: renderer});
  await writeFile(resolve(preview, "formation-demo.html"), output);
  console.log("編成デモ", data.cards.length, "体");
}

build().catch(error => { console.error(error); process.exitCode = 1; });
