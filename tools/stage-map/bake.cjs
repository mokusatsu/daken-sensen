function bake(page, input) {
  return page.evaluate(async ({regions, areas, starterIds, excludedIds, seedNumber, projection, elevations}) => {
    let seed = seedNumber;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }
    const reserved = new Set([...starterIds, ...excludedIds]);
    const candidates = units.filter(unit => !reserved.has(unit.id));
    const singles = shuffle(candidates.filter(unit => unit.type.length === 1));
    const doubles = shuffle(candidates.filter(unit => unit.type.length === 2));
    const starters = starterIds.map(id => units.find(unit => unit.id === id));
    const normalStages = regions.flatMap(region => region.ids.slice(0, -1));
    const earlyStages = normalStages.slice(0, Math.min(18, singles.length));
    const singleGates = new Set([...earlyStages,
      ...shuffle(normalStages.slice(earlyStages.length)).slice(0, singles.length - earlyStages.length)]);
    const gates = regions.flatMap(region => region.ids.map((id, index) => ({
      id, unit: (index < region.ids.length - 1 && singleGates.has(id) ? singles : doubles).pop(),
    })));
    const frame = document.createElement("canvas");
    const atlas = document.createElement("canvas");
    const cell = 96;
    const columns = 8;
    atlas.width = cell * columns;
    atlas.height = cell * Math.ceil((gates.length + starters.length) / columns);
    const atlasContext = atlas.getContext("2d");
    for (const [index, entry] of [...gates, ...starters.map(unit => ({unit}))].entries()) {
      const {unit} = entry;
      if (!unit) throw new Error("門番または初期手持ちの候補が不足しています");
      drawStack(frame, spriteFor(unit), 337);
      if (frame.width >= cell || frame.height >= cell) throw new Error("門番スプライトが大きすぎます");
      const x = index % columns * cell + 1;
      const y = Math.floor(index / columns) * cell + 1;
      atlasContext.drawImage(frame, x, y);
      entry.guard = {
        id: unit.id, name: unit.name, types: unit.type.map(code => types[code].slice(0, 3)),
        role: roles[unit.role][0], frame: [x, y, frame.width, frame.height],
      };
      delete entry.unit;
      if (index >= gates.length) starters[index - gates.length] = entry.guard;
    }

    const paths = new Map(areas.map(area => [area.id, new Path2D(area.path)]));
    const sheets = await Promise.all(regions.map(async region => {
      const [left, top] = region.origin;
      const [width, height] = region.size;
      const area = width * height;
      const terrain = new Image();
      terrain.src = elevations[region.id];
      await terrain.decode();
      const sample = document.createElement("canvas");
      sample.width = width;
      sample.height = height;
      const mask = sample.getContext("2d", {willReadFrequently: true});
      mask.drawImage(terrain, 0, 0);
      const dem = mask.getImageData(0, 0, width, height).data;
      const owner = new Uint8Array(area);
      const coverage = new Uint8Array(area);
      mask.lineWidth = .85;
      mask.lineJoin = "round";
      for (const id of region.ids) {
        mask.clearRect(0, 0, width, height);
        mask.save();
        mask.translate(-left, -top);
        mask.fill(paths.get(id), "evenodd");
        mask.stroke(paths.get(id));
        mask.restore();
        const alpha = mask.getImageData(0, 0, width, height).data;
        for (let i = 0; i < area; i++) {
          const strength = alpha[i * 4 + 3];
          if (strength >= 112 && strength > coverage[i]) {
            owner[i] = id;
            coverage[i] = strength;
          }
        }
      }
      const sheet = document.createElement("canvas");
      sheet.width = width * projection.layers;
      sheet.height = height;
      const ctx = sheet.getContext("2d");
      const layers = ctx.createImageData(sheet.width, height);
      const pixelIndex = mask.createImageData(width, height);
      const foundation = [[27, 34, 54], [56, 45, 65], [83, 58, 74], [121, 80, 82]];
      const bandCounts = new Array(projection.layers - projection.baseLand).fill(0);
      let missing = 0;
      let land = 0;
      for (let index = 0; index < area; index++) {
        const id = owner[index];
        const offset = index * 4;
        pixelIndex.data[offset + 3] = 255;
        if (!id) continue;
        land++;
        if (!dem[offset + 2]) missing++;
        const band = dem[offset];
        bandCounts[band]++;
        const ridge = projection.baseLand + band;
        const worldX = index % width;
        const row = Math.floor(index / width);
        const edge = owner[index - 1] !== id || owner[index + 1] !== id ||
          owner[index - width] !== id || owner[index + width] !== id;
        const grain = (Math.imul(left + worldX + 593, 92837111) ^ Math.imul(top + row + 169, 689287499)) >>> 0;
        const shade = dem[offset + 1] - (edge ? 20 : 0) - (grain % 13 === 0 ? 6 : 0);
        pixelIndex.data[offset] = id;
        pixelIndex.data[offset + 1] = band;
        pixelIndex.data[offset + 2] = shade;
        for (let z = 0; z <= ridge; z++) {
          const dest = (row * sheet.width + z * width + worldX) * 4;
          const color = foundation[z] ?? (z === ridge ? [228, 205, 170] : [149 + z * 2, 110 + z, 98 + (z % 3) * 6]);
          const light = z === ridge ? shade / 100 : 1;
          for (let c = 0; c < 3; c++) layers.data[dest + c] = color[c] * light;
          layers.data[dest + 3] = 255;
        }
      }
      ctx.putImageData(layers, 0, 0);
      mask.putImageData(pixelIndex, 0, 0);
      return {sheet: sheet.toDataURL("image/png"), index: sample.toDataURL("image/png"),
        maxBand: bandCounts.findLastIndex(count => count > 0), bandCounts, missing, land};
    }));
    return {gates, starters, sheets, guardAtlas: atlas.toDataURL("image/png")};
  }, input);
}

module.exports = {bake};
