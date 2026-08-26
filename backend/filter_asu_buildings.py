"""
Filter building data to only ASU Tempe campus area.
Run this in the backend directory.
"""

import json
from pathlib import Path

ASU_BOUNDS = {
    'min_lat': 33.4114,  # South edge
    'max_lat': 33.4296,  # North edge  
    'min_lon': -111.9437, # West edge 
    'max_lon': -111.9175  # East edge 
}

def point_in_bounds(lon, lat, bounds):
    """Check if a point is within bounds."""
    return (bounds['min_lon'] <= lon <= bounds['max_lon'] and
            bounds['min_lat'] <= lat <= bounds['max_lat'])

def filter_buildings():
    """Filter buildings to ASU campus area."""
    
    input_file = Path("data/buildings/asu_buildings.geojson")
    output_file = Path("data/buildings/asu_campus_only.geojson")
    
    if not input_file.exists():
        print(f"❌ Input file not found: {input_file}")
        print(f"   Please ensure you have downloaded the building data.")
        return
    
    print(f"📂 Loading buildings from: {input_file}")
    with open(input_file, 'r') as f:
        data = json.load(f)
    
    total_buildings = len(data.get('features', []))
    print(f"   Total buildings in file: {total_buildings}")
    
    filtered_features = []
    
    for feature in data['features']:
        geom = feature['geometry']
        
        if geom['type'] == 'Polygon':
            coords = geom['coordinates'][0]
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            center_lon = sum(lons) / len(lons)
            center_lat = sum(lats) / len(lats)
            
            if point_in_bounds(center_lon, center_lat, ASU_BOUNDS):
                filtered_features.append(feature)
        elif geom['type'] == 'MultiPolygon':
            coords = geom['coordinates'][0][0]
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            center_lon = sum(lons) / len(lons)
            center_lat = sum(lats) / len(lats)
            
            if point_in_bounds(center_lon, center_lat, ASU_BOUNDS):
                filtered_features.append(feature)
    
    print(f"   Buildings in ASU bounds: {len(filtered_features)}")
    print(f"   Filtered out: {total_buildings - len(filtered_features)} buildings")
    
    output_data = {
        'type': 'FeatureCollection',
        'features': filtered_features
    }
    
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n✅ Saved filtered buildings to: {output_file}")
    print(f"\n📝 To use this file, update backend/src/api.py:")
    print(f"   Change line:")
    print(f"   BUILDINGS_FILE = Path('data/buildings/asu_buildings.geojson')")
    print(f"   To:")
    print(f"   BUILDINGS_FILE = Path('data/buildings/asu_campus_only.geojson')")
    print(f"\n   Then restart the backend.")

if __name__ == "__main__":
    print("="*60)
    print("ASU Building Filter")
    print("="*60)
    print(f"\nFiltering to ASU campus bounds:")
    print(f"  Latitude:  {ASU_BOUNDS['min_lat']} to {ASU_BOUNDS['max_lat']}")
    print(f"  Longitude: {ASU_BOUNDS['min_lon']} to {ASU_BOUNDS['max_lon']}")
    print()
    
    filter_buildings()
    
    print("\n" + "="*60)