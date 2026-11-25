"""Cache source data and sample elevation on the map's pixel grid."""

import argparse
import base64
import hashlib
import io
import json
import math
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONFIG = json.loads((HERE / "maps.json").read_bytes())
TILE_SIZE = 256


def request(url):
    for attempt in range(2):
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if attempt or error.code < 500:
                raise
        except OSError:
            if attempt:
                raise


def save_download(url, path, headers):
    if path.exists():
        return
    data = request(url)
    if not data.startswith(headers):
        raise ValueError(f"Unexpected file format from {url}")
    path.write_bytes(data)


def parse_boundaries(work, config):
    boundary = config["boundary"]
    local = work / boundary["file"]
    data = local.read_bytes()
    checksum = hashlib.sha256(data).hexdigest()
    if boundary.get("sha256") and checksum != boundary["sha256"]:
        raise ValueError(f"Boundary SHA-256 mismatch: {local}")
    if boundary["format"] == "geojson":
        features = json.loads(data)["features"]
        shapes = [
            {"id": int(feature["properties"]["PREF_CODE"]), "name": feature["properties"]["N03_001"],
             "geometry": feature["geometry"]}
            for feature in features
        ]
    elif boundary["format"] == "census-kml":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            kml, = [entry for entry in archive.namelist() if entry.lower().endswith(".kml")]
            root = ET.fromstring(archive.read(kml))
        shapes = []
        for mark in root.findall(".//{*}Placemark"):
            fields = {node.attrib["name"]: node.text for node in mark.findall(".//{*}SimpleData")}
            if "STATEFP" not in fields:
                continue
            area_id = int(fields["STATEFP"])
            name = config["names"].get(str(area_id))
            if not name:
                continue
            polygons = []
            for polygon in mark.findall(".//{*}Polygon"):
                rings = []
                for boundary_ring in [polygon.find("{*}outerBoundaryIs"), *polygon.findall("{*}innerBoundaryIs")]:
                    text = boundary_ring.findtext(".//{*}coordinates")
                    rings.append([tuple(map(float, coord.split(",")[:2])) for coord in text.split()])
                polygons.append(rings)
            shapes.append({"id": area_id, "name": name, "geometry": {"type": "MultiPolygon", "coordinates": polygons}})
    else:
        raise ValueError(f"Unsupported border format: {boundary['format']}")
    regions = [area_id for region in config["regions"] for area_id in region["ids"]]
    shape_ids = [shape["id"] for shape in shapes]
    if sorted(regions) != sorted(shape_ids) or len(regions) != len(set(regions)):
        raise ValueError("Region configuration and boundary IDs differ")
    output = {"sha256": checksum, "shapes": shapes}
    (work / "boundaries.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return output


def mercator(lon, lat, world):
    x = (lon + 180) / 360 * world
    y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * world
    return x, y


def gsi_tiles(shapes, config):
    tiles = set()
    extent = config["defaultGrid"]["extent"]
    world = TILE_SIZE * (2 ** config["elevation"]["zoom"])
    for shape in shapes:
        geometry = shape["geometry"]
        coords = geometry["coordinates"]
        polygons = [coords] if geometry["type"] == "Polygon" else coords
        for ring, *_ in polygons:
            xy = np.asarray(ring)
            west, south = xy.min(axis=0)
            east, north = xy.max(axis=0)
            if west < extent[0] or south < extent[1] or east > extent[2] or north > extent[3]:
                continue
            if (east - west) * (north - south) < .00006:
                continue
            left, top = mercator(west, north, world)
            right, bottom = mercator(east, south, world)
            tiles.update((x, y) for x in range(int((left - 2) // TILE_SIZE), int((right + 2) // TILE_SIZE) + 1)
                         for y in range(int((top - 2) // TILE_SIZE), int((bottom + 2) // TILE_SIZE) + 1))
    return sorted(tiles)


def fetch_gsi(work, config, shapes):
    cache = work / "gsi"
    cache.mkdir(exist_ok=True)
    template = config["elevation"]["tiles"]

    def fetch(tile):
        x, y = tile
        try:
            save_download(template.format(x=x, y=y), cache / f"{x}-{y}.png", b"\x89PNG\r\n\x1a\n")
            return True
        except urllib.error.HTTPError as error:
            if error.code in (403, 404):
                return False
            raise

    tiles = gsi_tiles(shapes, config)
    with ThreadPoolExecutor(max_workers=6) as executor:
        present = list(executor.map(fetch, tiles))
    print(f"地理院タイル {sum(present)} / {len(tiles)} 枚")


def fetch_usgs(work, elevation):
    def fetch(tile):
        query = urllib.parse.urlencode({
            "bbox": ",".join(map(str, tile["bbox"])), "bboxSR": 4326, "imageSR": 4326,
            "size": ",".join(map(str, tile["size"])), "format": "tiff", "pixelType": "F32",
            "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "adjustAspectRatio": "false", "f": "image",
        })
        target = work / (tile["id"] + ".tiff")
        save_download(elevation["service"] + "?" + query, target, (b"II*\x00", b"MM\x00*"))
        with Image.open(target) as image:
            if list(image.size) != tile["size"] or image.mode != "F":
                raise ValueError(f"Expected a float elevation image of size {tile['size']}: {target}")
        print(f"USGS 標高ラスタ {tile['id']} {tile['size'][0]} × {tile['size'][1]}")

    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(fetch, elevation["tiles"]))


def download(work, config):
    boundary = config["boundary"]
    save_download(boundary["download"], work / boundary["file"], (b"{", b"PK\x03\x04"))
    source = parse_boundaries(work, config)
    print(f"境界データ {len(source['shapes'])} 件 SHA-256 {source['sha256']}")
    elevation = config["elevation"]
    if elevation["format"] == "gsi":
        fetch_gsi(work, config, source["shapes"])
    elif elevation["format"] == "usgs":
        fetch_usgs(work, elevation)
    else:
        raise ValueError(f"Unsupported elevation format: {elevation['format']}")


def bilinear(grid, x, y):
    """Interpolate valid pixels around a sample, with integer coordinates at pixel centres."""
    x = np.clip(x, 0, grid.shape[1] - 1.001)
    y = np.clip(y, 0, grid.shape[0] - 1.001)
    ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - ix, y - iy
    total = np.zeros(x.shape, dtype=np.float32)
    weights = np.zeros_like(total)
    for dx, dy, weight in [(0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                           (0, 1, (1 - fx) * fy), (1, 1, fx * fy)]:
        values = grid[iy + dy, ix + dx]
        valid = np.isfinite(values)
        weights += np.where(valid, weight, 0)
        total += np.where(valid, values * weight, 0)
    return np.divide(total, weights, out=np.full_like(total, np.nan), where=weights > 0)


def gsi_sampler(work, config, shapes):
    tiles = gsi_tiles(shapes, config)
    min_x = min(x for x, _ in tiles)
    min_y = min(y for _, y in tiles)
    max_x = max(x for x, _ in tiles)
    max_y = max(y for _, y in tiles)
    grid = np.full(((max_y - min_y + 1) * TILE_SIZE, (max_x - min_x + 1) * TILE_SIZE), np.nan, dtype=np.float32)
    files = []
    for x, y in tiles:
        path = work / "gsi" / f"{x}-{y}.png"
        if not path.is_file():
            continue
        files.append(path)
        with Image.open(path) as image:
            red, green, blue = np.asarray(image.convert("RGB"), dtype=np.int32).transpose(2, 0, 1)
        packed = (red << 16) | (green << 8) | blue
        signed = np.where(packed > 0x800000, packed - 0x1000000, packed)
        terrain = np.where(packed == 0x800000, np.nan, signed * .01)
        left, top = (x - min_x) * TILE_SIZE, (y - min_y) * TILE_SIZE
        grid[top:top + TILE_SIZE, left:left + TILE_SIZE] = terrain
    world = TILE_SIZE * (2 ** config["elevation"]["zoom"])

    def sample(lon, lat):
        x, y = mercator(lon, lat, world)
        return bilinear(grid, x - min_x * TILE_SIZE - .5, y - min_y * TILE_SIZE - .5)

    return sample, files


def usgs_sampler(work, config):
    grids = []
    files = []
    for tile in config["elevation"]["tiles"]:
        path = work / (tile["id"] + ".tiff")
        with Image.open(path) as image:
            if list(image.size) != tile["size"] or image.mode != "F":
                raise ValueError(f"Invalid DEM: {path}")
            west, south, east, north = tile["bbox"]
            scale = image.tag_v2[33550]
            tie = image.tag_v2[33922]
            extent = [tie[3], tie[4] - scale[1] * image.height,
                      tie[3] + scale[0] * image.width, tie[4]]
            if tie[:2] != (0., 0.) or not np.allclose(extent, [west, south, east, north], rtol=0, atol=1e-6):
                raise ValueError(f"Unexpected DEM extent: {path}")
            pixels = np.array(image, dtype=np.float32)
        pixels[(pixels < -1500) | (pixels > 9000)] = np.nan
        grids.append((tile["bbox"], pixels))
        files.append(path)

    def sample(lon, lat):
        lon = (lon + 180) % 360 - 180
        result = np.full(lon.shape, np.nan, dtype=np.float32)
        for (west, south, east, north), grid in grids:
            inside = (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
            x = (lon[inside] - west) / (east - west) * grid.shape[1] - .5
            y = (north - lat[inside]) / (north - south) * grid.shape[0] - .5
            result[inside] = bilinear(grid, x, y)
        return result

    return sample, files


def terrain_image(region, projection, sample):
    left, top = region["origin"]
    width, height = region["size"]
    vectors = [np.arange(amount, dtype=np.float32) + start + .5 for amount, start in [(width, left), (height, top)]]
    wx, wy = np.meshgrid(*vectors)
    grid = region["grid"]
    ox, oy = grid["offset"]
    lon0, lat0 = grid["centre"]
    resolution = grid["pixelsPerDegree"]
    yaw = math.radians(projection["yawDegrees"])
    cos, sin = math.cos(yaw), math.sin(yaw)
    lon = lon0 + ((wx - ox) * cos + (wy - oy) * sin) / (math.cos(math.radians(lat0)) * resolution)
    lat = lat0 - (-(wx - ox) * sin + (wy - oy) * cos) / resolution
    sampled = sample(lon, lat)
    valid = np.isfinite(sampled)
    heights = np.maximum(0, np.where(valid, sampled, 0))
    grad_y, grad_x = np.gradient(heights)
    light = np.rint(np.clip(100 + (grad_x + grad_y) * -.028, 84, 116)).astype(np.uint8)
    bands = np.floor(heights / projection["elevationStepMetres"]).astype(np.int16)
    bands = np.clip(bands, 0, projection["layers"] - 1 - projection["baseLand"])
    data = np.stack((bands.astype(np.uint8), light, valid.astype(np.uint8) * 255), axis=2)
    encoded = io.BytesIO()
    Image.fromarray(data).save(encoded, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


def prepare_elevation(work, config):
    geometry = json.loads((work / "geometry.json").read_bytes())
    if config["elevation"]["format"] == "gsi":
        borders = json.loads((work / "boundaries.json").read_bytes())
        sample, files = gsi_sampler(work, config, borders["shapes"])
    else:
        sample, files = usgs_sampler(work, config)
    if not files:
        raise ValueError("Elevation data missing. Run the download command first.")
    projection = geometry["projection"]
    images = {region["id"]: terrain_image(region, projection, sample) for region in geometry["regions"]}
    checksums = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
    output = {"images": images, "sha256": checksums}
    (work / "elevations.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("map", choices=CONFIG)
    parser.add_argument("command", choices=("download", "boundaries", "elevation"))
    args = parser.parse_args()
    work = ROOT / ".codex-temp" / "stage-maps" / args.map
    work.mkdir(parents=True, exist_ok=True)
    config = CONFIG[args.map]
    if args.command == "download":
        download(work, config)
    elif args.command == "boundaries":
        parse_boundaries(work, config)
    else:
        prepare_elevation(work, config)


if __name__ == "__main__":
    main()
