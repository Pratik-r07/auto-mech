# Auto-Mech Spares & Services — Invoicing App

Full-stack app for managing quotations, bills, and delivery challans.

- **Backend:** FastAPI + MongoDB (Motor), JWT auth
- **Frontend:** React (CRA + CRACO), Tailwind, shadcn/ui

## Prerequisites

- Python 3.10+
- Node.js 18+ and Yarn (or npm)
- MongoDB running locally (or a connection string to a hosted instance)

## 1. Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env            # then edit .env (JWT_SECRET especially)
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000/api`. On first run, an
admin user is created automatically using `ADMIN_EMAIL` / `ADMIN_PASSWORD`
from `.env` (defaults to `admin@example.com` / `admin123` — change these).

If you don't have MongoDB installed locally, the quickest option is Docker:

```bash
docker run -d --name mongo -p 27017:27017 mongo:7
```

## 2. Frontend setup

```bash
cd frontend
cp .env.example .env            # points at the backend from step 1
yarn install                    # or: npm install
yarn start                      # or: npm start
```

The app will open at `http://localhost:3000` and log in with the admin
credentials configured above.

## Notes

This project was originally scaffolded on the Emergent app-building
platform; all Emergent-specific tooling (analytics scripts, the visual
editor devDependency, health-check webpack plugin, and platform config
under `.emergent/`) has been removed so it runs as a plain FastAPI +
React app with no external platform dependencies.
