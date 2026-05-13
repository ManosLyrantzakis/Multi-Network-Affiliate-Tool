# Multi-Network Affiliate Tool

I built this application to **centralise affiliate operations** in one place: multiple advertiser networks, one data model, and a single UI for merchants, transactions, performance, and validation workflows. The stack is a **Vue 3** SPA on **Vite** talking to a **Node.js** **Express** API, with **SQLite** for persistence.

The system **pulls** transaction data from each network’s APIs (or hybrid flows where scraping is required), **normalises** records into a shared schema, and supports both **on-demand sync** from the dashboard and **scheduled** background jobs when cron is enabled.

**Repository:** [github.com/ManosLyrantzakis/Multi-Network-Affiliate-Tool](https://github.com/ManosLyrantzakis/Multi-Network-Affiliate-Tool)

---

## Capabilities

| Area | Behaviour |
|------|------------|
| **Merchants** | CRUD for brands / accounts per network; API keys and secrets stored **encrypted** in SQLite via `SECRET_KEY`. |
| **Sync** | Date-range transaction fetch per merchant; upsert into DB; aggregates for daily / publisher metrics where implemented. |
| **Reporting** | Performance dashboards, daily breakdowns, publisher views, transaction lists, Webgains **live KPI** panel (Platform performance API). |
| **Automation** | `node-cron` scheduler in the backend; optional **Playwright** for CJ flows that cannot be satisfied by REST alone. |

### Network integrations

- **AWIN** — REST (Bearer), transactions and performance where the API exposes them.
- **Impact** — REST (Account SID + auth token), actions and reporting as configured.
- **CJ (Rakuten Advertising)** — REST / GraphQL where available; Playwright for publisher / performance paths that need a browser.
- **Webgains** — Platform API (OAuth2 password grant); merchant and program IDs; DKK-oriented reporting and optional `WEBGAINS_FORCE_ROW_CURRENCY` for consistent stored ISO codes after re-sync (see Environment).

---

## Tech stack

| Layer | Choice |
|--------|--------|
| **UI** | Vue 3 (Composition API), Vite, Pinia, Bootstrap 5, Chart.js / vue-chartjs |
| **API** | Node.js 18+ (ES modules), Express, REST JSON |
| **Data** | SQLite via `better-sqlite3` — runtime DB under `backend/data/` (gitignored) |
| **Sessions** | `express-session` with file-based store |
| **Tooling** | `dotenv`, `cors`, `csv-parse`, `fast-xml-parser` |

---

## Repository layout

```
affiliate-tool-node-vue/
├── package.json              # root scripts; concurrently runs API + UI
├── backend/
│   ├── server.js             # HTTP API, sync, validation routes
│   ├── config.js             # env → config (see for variable names)
│   ├── fetchers/             # per-network clients
│   ├── normalization/        # raw payload → canonical transaction shape
│   ├── db/                   # schema + queries
│   ├── scripts/              # e.g. scheduler
│   └── .env                  # local only — never committed
└── frontend/
    └── src/                  # Vue app (Vite dev server, typically :5173)
```

---

## Prerequisites

- **Node.js** 18 or newer (LTS recommended)
- **npm**
- For CJ browser automation: `npm run playwright:install --prefix backend` once

---

## Local setup

```bash
cd affiliate-tool-node-vue
npm install
npm install --prefix backend
npm install --prefix frontend
```

### Environment

Create **`backend/.env`** locally (see `backend/config.js` for every key). Minimum:

- **`SECRET_KEY`** — drives encryption of stored merchant credentials.
- Network credentials and IDs as required by each integration (AWIN, CJ, Impact, Webgains).

Optional for Webgains: **`WEBGAINS_FORCE_ROW_CURRENCY=DKK`** — after sync, the stored `currency` column is normalised to DKK when mixed ISO tags appear on otherwise DKK-scoped reports; numeric conversion still follows each field’s ISO for minor→major. **Re-sync** applies it to existing rows.

Never commit `.env`, database files, or session stores; they are listed in `.gitignore`.

### Run (development)

```bash
npm run dev
# equivalent:
npm run dev:stable
```

- **Frontend:** `http://localhost:5173` (typical)
- **Backend:** port from `backend/server.js` (often **5001**; Vite proxy should match)

Smoke test: `GET /api/health`

### Production build (frontend only)

```bash
npm run build --prefix frontend
```

---

## Security

Do not push secrets. If you clone this repo, supply your own `.env` and generate your own `SECRET_KEY`. The application is intended for environments you control.

---

## License

Written for **internal / portfolio** use. Public hosting is at your discretion; add an explicit **LICENSE** file if you need a standard open-source terms.

---

**Manos Lyrantzakis** — design, implementation, and maintenance.
