#!/usr/bin/env python3
"""
Offline ASU canopy extraction from OpenTopography / LAStools TIN DSM.

Derives an approximate DTM via minimum-filter of the DSM, computes
CHM = DSM - DTM, masks building footprints, polygonizes remaining canopy,
and writes a compact GeoJSON for CampusShade runtime loading.

Usage (from backend/):
  python scripts/extract_canopy_from_tin.py ^
    --tin "%USERPROFILE%\\Downloads\\output.tin.tar.gz" ^
    --buildings data/buildings/asu_campus_only.geojson ^
    --out data/canopy/asu_canopy.geojson
"""

from __future__ import annotations

import argparse
import json
import tarfile
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import tifffile
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform as shp_transform
from shapely.validation import make_valid
from skimage import measure


def _load_tin_array(tin_path: Path) -> Tuple[np.ndarray, Dict]:
    tif_path = tin_path
    if tin_path.suffixes[-2:] == [".tar", ".gz"] or tin_path.name.endswith(".tar.gz"):
        tmpdir = Path(tempfile.mkdtemp(prefix="campusshade_tin_"))
        with tarfile.open(tin_path, "r:gz") as tar:
            tar.extractall(tmpdir)
        tifs = list(tmpdir.rglob("*.tif")) + list(tmpdir.rglob("*.tiff"))
        if not tifs:
            raise FileNotFoundError(f"No GeoTIFF inside {tin_path}")
        tif_path = tifs[0]

    with tifffile.TiffFile(tif_path) as tif:
        page = tif.pages[0]
        arr = page.asarray().astype(np.float32)
        tags = page.tags
        scale = tags["ModelPixelScaleTag"].value
        tie = tags["ModelTiepointTag"].value
        nodata = -9999.0
        if "GDAL_NODATA" in tags:
            try:
                nodata = float(str(tags["GDAL_NODATA"].value).split("\x00")[0])
            except Exception:
                pass

    meta = {
        "pixel_size_x": float(scale[0]),
        "pixel_size_y": float(scale[1]),
        "origin_x": float(tie[3]),
        "origin_y": float(tie[4]),
        "nodata": nodata,
        "crs": "EPSG:32612",
        "source": str(tif_path),
    }
    arr = np.where(arr == nodata, np.nan, arr)
    return arr, meta


def _rowcol_to_xy(row: float, col: float, meta: Dict) -> Tuple[float, float]:
    x = meta["origin_x"] + (col + 0.5) * meta["pixel_size_x"]
    y = meta["origin_y"] - (row + 0.5) * abs(meta["pixel_size_y"])
    return x, y


def _building_mask(shape_hw: Tuple[int, int], meta: Dict, buildings_path: Optional[Path]) -> np.ndarray:
    h, w = shape_hw
    mask = np.zeros((h, w), dtype=bool)
    if buildings_path is None or not buildings_path.exists():
        return mask

    with open(buildings_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32612", always_xy=True)
    ox, oy = meta["origin_x"], meta["origin_y"]
    sx = meta["pixel_size_x"]
    sy = abs(meta["pixel_size_y"])

    for feat in data.get("features", []):
        geom = shape(feat["geometry"])
        if geom.is_empty:
            continue
        geom_utm = shp_transform(lambda x, y, z=None: to_utm.transform(x, y), geom)
        minx, miny, maxx, maxy = geom_utm.bounds
        c0 = max(0, int((minx - ox) / sx) - 1)
        c1 = min(w - 1, int((maxx - ox) / sx) + 1)
        r0 = max(0, int((oy - maxy) / sy) - 1)
        r1 = min(h - 1, int((oy - miny) / sy) + 1)
        if c1 <= c0 or r1 <= r0:
            continue
        mask[r0 : r1 + 1, c0 : c1 + 1] = True

    return ndimage.binary_dilation(mask, iterations=2)


def extract_canopy(
    dsm: np.ndarray,
    meta: Dict,
    buildings_path: Optional[Path],
    min_height_m: float = 2.0,
    max_height_m: float = 45.0,
    ground_radius_m: float = 20.0,
    min_area_m2: float = 12.0,
    simplify_m: float = 1.5,
) -> List[Dict]:
    px = max(meta["pixel_size_x"], 0.5)
    radius_px = max(3, int(round(ground_radius_m / px)))
    valid = np.isfinite(dsm)
    filled = dsm.copy()
    if np.any(~valid):
        ind = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
        filled = dsm[tuple(ind)]

    print(f"Estimating DTM with minimum_filter size={radius_px * 2 + 1} ...", flush=True)
    dtm = ndimage.minimum_filter(filled, size=radius_px * 2 + 1)
    dtm = ndimage.uniform_filter(dtm, size=max(3, radius_px // 2))
    chm = np.where(valid, dsm - dtm, np.nan)

    print("Masking building footprints ...", flush=True)
    bmask = _building_mask(dsm.shape, meta, buildings_path)
    canopy = (chm >= min_height_m) & (chm <= max_height_m) & (~bmask) & valid
    canopy = ndimage.binary_opening(canopy, structure=np.ones((3, 3)))
    canopy = ndimage.binary_closing(canopy, structure=np.ones((3, 3)))

    print("Tracing canopy contours (single pass) ...", flush=True)
    contours = measure.find_contours(canopy.astype(np.float32), 0.5)
    print(f"Found {len(contours)} contours", flush=True)

    to_wgs = Transformer.from_crs("EPSG:32612", "EPSG:4326", always_xy=True)
    features: List[Dict] = []

    for contour in contours:
        if len(contour) < 4:
            continue
        step = max(1, len(contour) // 60)
        sampled = contour[::step]
        coords_utm = [_rowcol_to_xy(row, col, meta) for row, col in sampled]
        if coords_utm[0] != coords_utm[-1]:
            coords_utm.append(coords_utm[0])

        poly = Polygon(coords_utm)
        if not poly.is_valid:
            poly = make_valid(poly)
        if poly.is_empty:
            continue
        parts = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]

        for part in parts:
            if part.is_empty or part.area < min_area_m2:
                continue
            if simplify_m > 0:
                part = part.simplify(simplify_m, preserve_topology=True)
            if part.is_empty or part.area < min_area_m2:
                continue

            cx, cy = part.centroid.x, part.centroid.y
            col = int((cx - meta["origin_x"]) / meta["pixel_size_x"])
            row = int((meta["origin_y"] - cy) / abs(meta["pixel_size_y"]))
            hs = []
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    rr, cc = row + dr, col + dc
                    if 0 <= rr < chm.shape[0] and 0 <= cc < chm.shape[1]:
                        val = chm[rr, cc]
                        if np.isfinite(val) and val >= min_height_m:
                            hs.append(float(val))
            if not hs:
                continue
            height = float(np.percentile(hs, 90))
            if not (min_height_m <= height <= max_height_m):
                continue

            poly_ll = shp_transform(lambda x, y, z=None: to_wgs.transform(x, y), part)
            if poly_ll.is_empty:
                continue
            ll_parts = list(poly_ll.geoms) if poly_ll.geom_type == "MultiPolygon" else [poly_ll]
            for ll in ll_parts:
                if ll.is_empty:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "geometry": mapping(ll),
                        "properties": {
                            "height": round(height, 2),
                            "name": "canopy",
                            "source": "lidar_tin_chm_2020",
                            "area_m2": round(float(part.area), 1),
                        },
                    }
                )

    return features


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tin", required=True)
    parser.add_argument("--buildings", default="data/buildings/asu_campus_only.geojson")
    parser.add_argument("--out", default="data/canopy/asu_canopy.geojson")
    parser.add_argument("--min-height", type=float, default=2.0)
    parser.add_argument("--max-height", type=float, default=45.0)
    parser.add_argument("--ground-radius", type=float, default=20.0)
    parser.add_argument("--min-area", type=float, default=12.0)
    args = parser.parse_args()

    tin_path = Path(args.tin).expanduser()
    buildings_path = Path(args.buildings)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading TIN from {tin_path} ...", flush=True)
    dsm, meta = _load_tin_array(tin_path)
    print(
        f"DSM shape={dsm.shape} nodata={meta['nodata']} "
        f"origin=({meta['origin_x']}, {meta['origin_y']})",
        flush=True,
    )

    features = extract_canopy(
        dsm,
        meta,
        buildings_path if buildings_path.exists() else None,
        min_height_m=args.min_height,
        max_height_m=args.max_height,
        ground_radius_m=args.ground_radius,
        min_area_m2=args.min_area,
    )
    heights = [f["properties"]["height"] for f in features]
    geojson = {
        "type": "FeatureCollection",
        "properties": {
            "source": "OpenTopography USGS 3DEP / LAStools TIN (~2020 ASU Tempe)",
            "method": "DSM minimum-filter CHM; buildings masked",
            "count": len(features),
        },
        "features": features,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f)
    print(f"Wrote {len(features)} canopy crowns -> {out_path}", flush=True)
    if heights:
        print(
            f"Height m: min={min(heights):.1f} mean={sum(heights)/len(heights):.1f} "
            f"max={max(heights):.1f}",
            flush=True,
        )


if __name__ == "__main__":
    main()
