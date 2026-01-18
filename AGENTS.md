# Repository Guidelines

## Project Structure & Module Organization
Sanctum is a Docker Compose stack. The root includes `docker-compose.yml`, environment files, and `docs/` for longer guides. The FastAPI backend lives in `backend/app/` (LLM providers in `backend/app/llm/`). The Vite + React frontend lives in `frontend/src/` with pages, components, and i18n files under `frontend/src/i18n/locales/`. Runtime ingest artifacts are stored in `uploads/` (mounted into the backend container).

## Build, Test, and Development Commands
Run the full stack from the repo root:
```bash
docker compose up --build        # build + start all services
docker compose up --build -d     # detached mode
docker compose logs -f backend   # follow backend logs
docker compose down              # stop services
```
Frontend-only development:
```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build
npm run preview   # serve dist/
```
Smoke tests:
```bash
curl http://localhost:8000/test
curl http://localhost:8000/llm/test
```

## Coding Style & Naming Conventions
Python uses 4-space indentation and type hints. Prefer `snake_case` for functions/modules and `CamelCase` for classes/Pydantic models. TypeScript/TSX uses 2-space indentation and single quotes; React components are `PascalCase.tsx` (e.g., `ChatPage.tsx`). Keep Tailwind class lists readable and reuse shared components in `frontend/src/components/`.

## Testing Guidelines
No automated test framework is configured yet. Validate changes via the smoke test endpoints and the frontend Test Dashboard (`/` route). Include the exact commands or steps you ran in your PR.

## Commit & Pull Request Guidelines
Commit history favors short, action-oriented messages (often lowercase, e.g., “smoke test successful”). Keep messages concise; use `WIP` only for clearly unfinished work. PRs should include a brief summary, linked issues (if any), testing evidence, and screenshots for UI changes.

## Security & Configuration Tips
Copy `.env.example` to `.env` and set `MAPLE_API_KEY`. Never commit secrets. The embedding model cache is stored in a Docker volume, and `uploads/` contains local ingest data that should not be checked in.
