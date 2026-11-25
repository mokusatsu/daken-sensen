const assert = require("node:assert/strict");

function longitudeFrom(lon, centre) {
  const delta = lon - centre;
  if (delta < -180) return lon + 360;
  if (delta > 180) return lon - 360;
  return lon;
}

function project([lon, lat], grid, yaw) {
  const [lon0, lat0] = grid.centre;
  const x = (lon - lon0) * Math.cos(lat0 * Math.PI / 180) * grid.pixelsPerDegree;
  const y = (lat0 - lat) * grid.pixelsPerDegree;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [x * cosine - y * sine + grid.offset[0], x * sine + y * cosine + grid.offset[1]];
}

function boundsFor(points) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    result[0] = Math.min(result[0], x);
    result[1] = Math.min(result[1], y);
    result[2] = Math.max(result[2], x);
    result[3] = Math.max(result[3], y);
  }
  return result;
}

function area(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

function simplify(closed, tolerance) {
  const keep = new Set([0, closed.length - 1]);
  const ranges = [[0, closed.length - 1]];
  while (ranges.length) {
    const [start, end] = ranges.pop();
    let max = tolerance ** 2;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = segmentDistance(...closed[i], closed[start], closed[end]);
      if (dist > max) {
        max = dist;
        index = i;
      }
    }
    if (index === -1) continue;
    keep.add(index);
    ranges.push([start, index], [index, end]);
  }
  return [...keep].sort((a, b) => a - b).slice(0, -1).map(i =>
    closed[i].map(value => Math.round(value * 4) / 4));
}

function pointInPolygon(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
  }
  return inside;
}

function gatePosition(polygon, name) {
  const [minX, minY, maxX, maxY] = boundsFor(polygon[0]);
  let best = null;
  let bestDistance = -1;
  let dx = (maxX - minX) / 16;
  let dy = (maxY - minY) / 16;
  let center = [(minX + maxX) / 2, (minY + maxY) / 2];
  for (let refinement = 0; refinement < 3; refinement++) {
    const steps = refinement === 0 ? 8 : 3;
    for (let j = -steps; j <= steps; j++) {
      for (let i = -steps; i <= steps; i++) {
        const x = center[0] + i * dx;
        const y = center[1] + j * dy;
        if (!pointInPolygon(x, y, polygon)) continue;
        let edge = Infinity;
        for (const ring of polygon) {
          for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
            edge = Math.min(edge, segmentDistance(x, y, ring[a], ring[b]));
          }
        }
        if (edge > bestDistance) {
          best = [x, y];
          bestDistance = edge;
        }
      }
    }
    assert(best, "門番の位置を取得できません " + name);
    center = best;
    dx /= 3;
    dy /= 3;
  }
  const snapped = best.map(value => Math.round(value * 4) / 4);
  return pointInPolygon(...snapped, polygon) ? snapped : best;
}

function areaGeometry(shape, grid, yaw) {
  const {id, name, geometry} = shape;
  const [west, south, east, north] = grid.extent;
  const multi = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const polygons = multi.map(polygon => polygon.map(ring =>
    ring.map(([lon, lat]) => [longitudeFrom(lon, grid.centre[0]), lat]))).filter(([ring]) => {
    const [minX, minY, maxX, maxY] = boundsFor(ring);
    return minX >= west && minY >= south && maxX <= east && maxY <= north;
  }).map(polygon => polygon.map(ring => simplify(ring.map(point => project(point, grid, yaw)), .32)))
    .filter(([outer]) => outer.length >= 3 && area(outer) >= .44)
    .map(([outer, ...holes]) => [outer, ...holes.filter(hole => hole.length >= 3 && area(hole) >= .5)]);
  assert(polygons.length, name + " の陸地が表示範囲にありません");
  polygons.sort((a, b) => area(b[0]) - area(a[0]));
  const outline = polygons.flat();
  const bounds = boundsFor(outline.flat());
  const anchor = gatePosition(polygons[0], name);
  const path = outline.map(ring => "M" + ring.map(point => point.join(",")).join("L") + "Z").join("");
  return {id, name, anchor, bounds, focus: boundsFor(polygons[0][0]), path};
}

function unionBounds(areas, key) {
  return boundsFor(areas.flatMap(shape => {
    const [minX, minY, maxX, maxY] = shape[key];
    return [[minX, minY], [maxX, maxY]];
  }));
}

function prepareGeometry(config, shapes) {
  const source = new Map(shapes.map(shape => [shape.id, shape]));
  const yaw = config.projection.yawDegrees * Math.PI / 180;
  const areas = [];
  const regions = config.regions.map(region => {
    const grid = region.grid ?? config.defaultGrid;
    const group = region.ids.map(id => areaGeometry(source.get(id), grid, yaw));
    areas.push(...group);
    const bounds = unionBounds(group, "bounds");
    const left = Math.floor(bounds[0]) - 4;
    const top = Math.floor(bounds[1]) - 4;
    return {
      ...region, grid, origin: [left, top], bounds,
      size: [Math.ceil(bounds[2]) - left + 4, Math.ceil(bounds[3]) - top + 4],
      focus: region.inset ? bounds : unionBounds(group, "focus"),
    };
  });
  assert.equal(new Set(areas.map(area => area.id)).size, shapes.length);
  return {projection: config.projection, regions, areas};
}

module.exports = {prepareGeometry};
