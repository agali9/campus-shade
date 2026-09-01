# CampusShade

Shade-aware walking routes for ASU Tempe. The live site is [https://campus-shade.agali9.workers.dev/](https://campus-shade.agali9.workers.dev/).

The map is hosted on Cloudflare. Route and shadow calculations run on a separate API at Render. You do not need to install anything to use it.

## Using the site

The campus map opens on Tempe. A panel in the corner is how you plan a walk.

1. Set a start and a destination. Type a campus place in either box, or press **Choose point** and tap the map. Clicks snap to the nearest walkable path.
2. Wait until the line under the buttons says **Ready to route.** Then press **Go**.
3. Two walks show up: a green **Shade route** and a blue **Fastest** walk. Distance is in meters. Turn either layer off with the chips if you only want one.
4. **Shadows** paints a flat grey mask where buildings cast shade. If the sun is down, that layer stays empty and the shade route matches the fastest route.
5. **Plan** lets you pick a date and time instead of “right now” in Phoenix. It shows that day’s sunrise and sunset. **Use this time** applies it. **Now** goes back to the live clock.
6. **Clear** wipes the points and the drawn routes.

## When the backend is ready

Render sleeps when nobody has used it. The first visit can take up to a minute while it wakes.

The panel tells you where that stands:

- **Checking the route server…** — the page is asking the API if it is up.
- **The route server is waking up…** — the site is open, but the API has not answered yet. Shadows may appear before routes work.
- **The map server is up. Routes are still loading…** — buildings and shadows can load, but the walk network is not ready. Do not press Go yet.
- **Ready to route.** — press Go.

If you press Go too early, the panel says to wait and try again. Grey shadows on the map only mean the shadow request succeeded. Routes are ready when the status line says so.

## Run locally

You only need this if you are changing the code. The deployed site is enough to use the app.

**Backend**

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Optional `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

Add `?debug=1` for extra system details. The first local start still has to load campus buildings and the walk graph.

## Tests

```bash
cd backend
# PowerShell
$env:SKIP_DATA_LOADING="1"
python -m pytest -q

cd frontend
npm run test
```

Routing details are in `PROJECT_RUNDOWN.md` and `ARCHITECTURE.md`.
