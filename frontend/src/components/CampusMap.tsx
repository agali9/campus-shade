import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef, StyleSpecification } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Location } from '../types';

// MapLibre v6 worker is a separate ESM file; Vite must emit it or the SPA
// fallback serves index.html and the browser rejects it as the wrong MIME type.
setWorkerUrl(maplibreWorkerUrl);

/** Free raster basemap (no API key). Esri public tiles; OSM attribution still shown. */
const DEFAULT_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'esri-street',
      type: 'raster',
      source: 'esri',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

const MAP_STYLE: string | StyleSpecification =
  import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_RASTER_STYLE;

// [west, south, east, north]
const ASU_MAX_BOUNDS: [number, number, number, number] = [
  -111.945, 33.410, -111.918, 33.432,
];
const ASU_MAX_BOUNDS_MOBILE: [number, number, number, number] = [
  -111.952, 33.405, -111.912, 33.436,
];

const defaultView = {
  longitude: -111.9281,
  latitude: 33.4242,
  zoom: 15.5,
};

interface CampusMapProps {
  startLocation: Location | null;
  endLocation: Location | null;
  fastestPath: [number, number][] | null;
  shadedPath: [number, number][] | null;
  shadowData: any;
  buildingData: any;
  onMapClick: (location: Location) => void;
  pickMode?: 'start' | 'end' | null;
  onMapInteract?: () => void;
}

export type CampusMapHandle = {
  getCenter: () => Location | null;
  fitRoutes: (paths: Array<[number, number][] | null | undefined>) => void;
  flyTo: (location: Location, zoom?: number) => void;
};

function emptyFeatureCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function featureCollectionFromPaths(
  paths: { coordinates: number[][][] }[]
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: paths.map((p, i) => ({
      type: 'Feature',
      id: i,
      properties: {},
      geometry: { type: 'Polygon', coordinates: p.coordinates },
    })),
  };
}

function asFeatureCollection(data: any): FeatureCollection {
  if (!data) return emptyFeatureCollection();
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    // Explode MultiPolygons — MapLibre fills are more reliable as Polygon features.
    const features: FeatureCollection['features'] = [];
    data.features.forEach((feature: any, idx: number) => {
      const geometry = feature?.geometry;
      if (!geometry?.coordinates) return;
      if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((coords: number[][][], part: number) => {
          if (!coords?.[0] || coords[0].length < 4) return;
          features.push({
            type: 'Feature',
            id: idx * 100000 + part,
            properties: feature.properties || {},
            geometry: { type: 'Polygon', coordinates: coords },
          });
        });
      } else if (geometry.type === 'Polygon') {
        if (!geometry.coordinates?.[0] || geometry.coordinates[0].length < 4) return;
        features.push({
          type: 'Feature',
          id: idx,
          properties: feature.properties || {},
          geometry,
        });
      }
    });
    return { type: 'FeatureCollection', features };
  }
  return featureCollectionFromPaths(extractPolygons(data));
}

function extractPolygons(data: any): { coordinates: number[][][] }[] {
  if (!data) return [];
  const geometries: any[] = [];
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    data.features.forEach((f: any) => f?.geometry && geometries.push(f.geometry));
  } else if (data.type === 'Feature' && data.geometry) {
    geometries.push(data.geometry);
  } else if (data.geometry) {
    geometries.push(data.geometry);
  } else if (Array.isArray(data)) {
    data.forEach((f: any) => f?.geometry && geometries.push(f.geometry));
  }

  const polygons: { coordinates: number[][][] }[] = [];
  for (const geometry of geometries) {
    if (!geometry?.coordinates) continue;
    if (geometry.type === 'Polygon') {
      polygons.push({ coordinates: geometry.coordinates });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((poly: number[][][]) => {
        polygons.push({ coordinates: poly });
      });
    }
  }
  return polygons;
}

function drawRouteLine(
  ctx: CanvasRenderingContext2D,
  map: ReturnType<MapRef['getMap']>,
  coords: [number, number][] | null,
  color: string,
  width: number,
) {
  if (!coords || coords.length < 2) return;
  ctx.beginPath();
  coords.forEach(([lng, lat], idx) => {
    const p = map.project([lng, lat]);
    if (idx === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function PinMarker({
  location,
  color,
  label,
}: {
  location: Location;
  color: string;
  label: string;
}) {
  return (
    <Marker longitude={location.lon} latitude={location.lat} anchor="bottom">
      <div
        style={{
          background: color,
          color: 'white',
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 13,
          border: '2px solid white',
          pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        }}
      >
        {label}
      </div>
    </Marker>
  );
}

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  {
    startLocation,
    endLocation,
    fastestPath,
    shadedPath,
    shadowData,
    buildingData,
    onMapClick,
    pickMode = null,
    onMapInteract,
  },
  ref
) {
  const mapRef = useRef<MapRef>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMapInteractRef = useRef(onMapInteract);
  onMapInteractRef.current = onMapInteract;
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useImperativeHandle(ref, () => ({
    getCenter: () => {
      const map = mapRef.current?.getMap();
      if (!map) return null;
      const center = map.getCenter();
      return { lat: center.lat, lon: center.lng };
    },
    flyTo: (location, zoom = 16.5) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      map.flyTo({
        center: [location.lon, location.lat],
        zoom,
        duration: 700,
      });
    },
    fitRoutes: (paths) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const coords = paths.flatMap((path) => path ?? []);
      if (coords.length < 2) return;
      let minLng = coords[0][0];
      let maxLng = coords[0][0];
      let minLat = coords[0][1];
      let maxLat = coords[0][1];
      for (const [lng, lat] of coords) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      const sheetPx = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--route-sheet-height-px')
      );
      const bottomPad = Number.isFinite(sheetPx) && sheetPx > 0 ? sheetPx + 16 : 48;
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: {
            top: 56,
            left: 28,
            right: 28,
            bottom: bottomPad,
          },
          maxZoom: 17.5,
          duration: 700,
        }
      );
    },
  }));

  const buildingsGeo = useMemo(() => asFeatureCollection(buildingData), [buildingData]);
  const shadowsGeo = useMemo(() => asFeatureCollection(shadowData), [shadowData]);
  const shadowsGeoRef = useRef(shadowsGeo);
  shadowsGeoRef.current = shadowsGeo;
  const fastestPathRef = useRef(fastestPath);
  fastestPathRef.current = fastestPath;
  const shadedPathRef = useRef(shadedPath);
  shadedPathRef.current = shadedPath;

  // Canvas overlay — MapLibre GeoJSON layers do not paint reliably with this raster style.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let attachedMap: ReturnType<MapRef['getMap']> | null = null;

    const draw = () => {
      const map = mapRef.current?.getMap();
      if (!map || !canvas) return;
      const mapCanvas = map.getCanvas();
      const width = mapCanvas.clientWidth;
      const height = mapCanvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const shade = document.createElement('canvas');
      shade.width = width;
      shade.height = height;
      const shadeCtx = shade.getContext('2d');
      if (shadeCtx) {
        shadeCtx.fillStyle = '#94a3b8';
        for (const feature of shadowsGeoRef.current.features) {
          const geometry = feature.geometry;
          if (!geometry || geometry.type !== 'Polygon') continue;
          const ring = geometry.coordinates?.[0];
          if (!ring || ring.length < 4) continue;
          shadeCtx.beginPath();
          ring.forEach((pos, idx) => {
            const p = map.project([pos[0], pos[1]]);
            if (idx === 0) shadeCtx.moveTo(p.x, p.y);
            else shadeCtx.lineTo(p.x, p.y);
          });
          shadeCtx.closePath();
          shadeCtx.fill();
        }
        ctx.globalAlpha = 0.42;
        ctx.drawImage(shade, 0, 0);
        ctx.globalAlpha = 1;
      }

      drawRouteLine(ctx, map, fastestPathRef.current, '#3b82f6', 5);
      drawRouteLine(ctx, map, shadedPathRef.current, '#10b981', 6);
    };

    const attach = () => {
      const map = mapRef.current?.getMap();
      if (!map || attachedMap === map) {
        if (map) draw();
        return !!map;
      }
      attachedMap = map;
      map.on('render', draw);
      draw();
      return true;
    };

    const wait = () => {
      if (attach()) return;
      raf = window.requestAnimationFrame(wait);
    };
    wait();

    return () => {
      window.cancelAnimationFrame(raf);
      if (attachedMap) {
        attachedMap.off('render', draw);
      }
    };
  }, [shadowsGeo, fastestPath, shadedPath]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
      }}
    >
      <Map
        ref={mapRef}
        initialViewState={defaultView}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        maxBounds={isMobile ? ASU_MAX_BOUNDS_MOBILE : ASU_MAX_BOUNDS}
        minZoom={isMobile ? 13 : 13.5}
        maxZoom={20}
        cursor={pickMode ? 'crosshair' : undefined}
        onDragStart={() => onMapInteractRef.current?.()}
        onTouchStart={() => onMapInteractRef.current?.()}
        onClick={(e) => {
          onMapInteractRef.current?.();
          if (!pickMode) return;
          onMapClickRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        <Source id="buildings" type="geojson" data={buildingsGeo}>
          <Layer
            id="buildings-fill"
            type="fill"
            paint={{
              'fill-color': '#94a3b8',
              'fill-opacity': 0.25,
            }}
          />
          <Layer
            id="buildings-outline"
            type="line"
            paint={{
              'line-color': '#64748b',
              'line-width': 1,
              'line-opacity': 0.7,
            }}
          />
        </Source>

        {startLocation && (
          <PinMarker location={startLocation} color="#16a34a" label="A" />
        )}
        {endLocation && (
          <PinMarker location={endLocation} color="#dc2626" label="B" />
        )}
      </Map>

      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />

      {pickMode && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -100%)',
            zIndex: 4,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: pickMode === 'start' ? '#16a34a' : '#dc2626',
              border: '3px solid #fff',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.35)',
            }}
          />
          <div
            style={{
              width: 2,
              height: 14,
              background: pickMode === 'start' ? '#16a34a' : '#dc2626',
              marginTop: -2,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.2)',
            }}
          />
        </div>
      )}
    </div>
  );
});
