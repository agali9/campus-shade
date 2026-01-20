#!/usr/bin/env python3
"""
Verify that everything is set up correctly before starting the application.
Run this BEFORE starting the backend server.
"""

import sys
from pathlib import Path
import json

def check_file_exists(path: Path, description: str) -> bool:
    """Check if a file exists and report status."""
    if path.exists():
        print(f"Γ£à {description}: {path}")
        return True
    else:
        print(f"Γ¥î {description} MISSING: {path}")
        return False

def check_building_data():
    """Check if building data is valid."""
    building_file = Path("data/buildings/asu_buildings.geojson")
    
    if not building_file.exists():
        print(f"\nΓ¥î CRITICAL: Building data not found!")
        print(f"   Expected: {building_file.absolute()}")
        print(f"\n   To fix:")
        print(f"   1. cd backend")
        print(f"   2. python download_tempe_data.py")
        return False
    
    # Check file size
    size = building_file.stat().st_size
    if size < 1000:  # Less than 1KB is definitely wrong
        print(f"Γ¥î Building data file too small: {size} bytes")
        print(f"   File may be corrupted. Re-download.")
        return False
    
    # Try to parse JSON
    try:
        with open(building_file) as f:
            data = json.load(f)
        
        num_features = len(data.get('features', []))
        if num_features == 0:
            print(f"Γ¥î Building data has 0 features!")
            print(f"   File exists but contains no buildings.")
            return False
        
        print(f"Γ£à Building data: {num_features} buildings ({size:,} bytes)")
        
        # Check first feature
        if num_features > 0:
            first = data['features'][0]
            has_geometry = 'geometry' in first
            has_height = 'height' in first.get('properties', {})
            
            if not has_geometry:
                print(f"ΓÜá∩╕Å  Warning: Features missing geometry")
            if not has_height:
                print(f"ΓÜá∩╕Å  Warning: Features missing height data")
        
        return True
        
    except json.JSONDecodeError as e:
        print(f"Γ¥î Building data is not valid JSON: {e}")
        return False
    except Exception as e:
        print(f"Γ¥î Error reading building data: {e}")
        return False

def check_dependencies():
    """Check if required Python packages are installed."""
    required = [
        'fastapi',
        'uvicorn',
        'shapely',
        'geopandas',
        'pyproj',
        'pvlib',
        'pytz'
    ]
    
    missing = []
    for package in required:
        try:
            __import__(package)
            print(f"Γ£à {package}")
        except ImportError:
            print(f"Γ¥î {package} NOT INSTALLED")
            missing.append(package)
    
    if missing:
        print(f"\nΓ¥î Missing packages: {', '.join(missing)}")
        print(f"   Install with: pip install {' '.join(missing)}")
        return False
    
    return True

def check_source_files():
    """Check if all required source files exist."""
    files = [
        ('src/api.py', 'Main API file'),
        ('src/shadow_calculator.py', 'Shadow calculator'),
        ('src/building_data_loader.py', 'Building loader'),
        ('src/street_router.py', 'Street router'),
    ]
    
    all_exist = True
    for filepath, description in files:
        if not check_file_exists(Path(filepath), description):
            all_exist = False
    
    return all_exist

def main():
    print("="*70)
    print("≡ƒöì SETUP VERIFICATION")
    print("="*70)
    print()
    
    # Change to backend directory if not already there
    if Path('backend').exists() and not Path('src').exists():
