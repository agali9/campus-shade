# CampusShade

Shade-Optimized Route Planner built with FastAPI + TypeScript client, backed by a PostgreSQL/PostGIS-ready route datastore.

## Quick start

```bash
# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000

Optional `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

See `PROJECT_RUNDOWN.md` and `ARCHITECTURE.md` for deeper docs.
