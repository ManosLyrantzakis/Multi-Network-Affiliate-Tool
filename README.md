# Affiliate Merchant Tool

Εσωτερικό εργαλείο για **συγκέντρωση, συγχρονισμό και προβολή** affiliate δεδομένων από πολλαπλά δίκτυα (AWIN, CJ, Impact, Webgains) σε ένα dashboard. Αναπτύχθηκε για τις ανάγκες της **εταιρείας στην οποία εργάζομαι** (εσωτερική χρήση / portfolio).

**English (e.g. GitHub description):** Multi-network affiliate dashboard and sync tool (AWIN, CJ, Impact, Webgains) — **Node.js** API + **Vue** frontend. Fetches and normalizes transactions, performance reporting, and Webgains live KPIs; supports **manual sync** from the UI and **automated / scheduled** background sync when the backend worker and cron are configured.

> **Σημαντικό:** Μην ανεβάζεις ποτέ secrets (`.env`, API keys, tokens). Το `.gitignore` αποκλείει `.env` και τη βάση· κράτα αντίγραφα ρυθμίσεων μόνο τοπικά ή σε ασφαλές password manager.

---

## Τι κάνει το tool

- **Merchants:** Διαχείριση brands / λογαριασμών ανά δίκτυο (credentials αποθηκευμένα κρυπτογραφημένα στη SQLite).
- **Sync:** Λήψη συναλλαγών (transactions) ανά merchant και χρονικό εύρος· κανονικοποίηση σε κοινό σχήμα στη βάση· **χειροκίνητο sync** από το UI και **αυτόματο / προγραμματισμένο** sync μέσω backend cron όταν είναι ρυθμισμένο.
- **Dashboard / reports:** Προβολή performance, ημερήσια στατιστικά, publishers όπου υποστηρίζεται από το δίκτυο.
- **Δίκτυα (integrations):**
  - **AWIN** — REST API (Bearer token), transactions + performance όπου εφαρμόζεται.
  - **Impact** — REST API (Account SID + Auth Token), actions / clicks όπου ρυθμισμένο.
  - **CJ (Rakuten Advertising)** — REST / GraphQL όπου ρυθμισμένο + Playwright scraping όπου χρειάζεται.
  - **Webgains** — Platform API (OAuth2 password grant + merchant/program IDs).

---

## Tech stack

| Επίπεδο | Τεχνολογία |
|--------|------------|
| **Frontend** | Vue 3 (Composition API), Vite, Pinia, Bootstrap 5, Chart.js / vue-chartjs |
| **Backend** | Node.js 18+ (ES modules), Express |
| **Βάση** | SQLite (`better-sqlite3`) — αρχείο DB κάτω από `backend/data/` (εξαιρείται από git) |
| **Auth / sessions** | `express-session` + file-based session store |
| **Automation** | `node-cron`, optional Playwright (Chromium) για CJ flows |
| **Άλλα** | `dotenv`, `cors`, `csv-parse`, `fast-xml-parser` |

**Δομή monorepo (workspace):**

```
affiliate-tool-node-vue/
├── package.json          # concurrently: τρέχει backend + frontend μαζί
├── backend/              # Express API + fetchers + DB
│   ├── server.js
│   ├── config.js
│   ├── fetchers/
│   ├── db/
│   └── .env              # δημιουργείται τοπικά — ΟΧΙ στο git
└── frontend/             # Vue + Vite (συνήθως http://localhost:5173)
```

---

## Προαπαιτούμενα

- [Node.js](https://nodejs.org/) **18 ή νεότερο** (LTS συνιστάται)
- npm (έρχεται με Node)
- Για CJ με Playwright: `npm run playwright:install --prefix backend` (μία φορά)

---

## Εγκατάσταση & τρέξιμο (τοπικά)

```bash
cd affiliate-tool-node-vue

# Root (concurrently)
npm install

# Backend
npm install --prefix backend

# Frontend
npm install --prefix frontend
```

Δημιούργησε `backend/.env` από το παράδειγμα της ομάδας σου (χωρίς πραγματικά secrets στο git). Ελέγξε τουλάχιστον:

- `SECRET_KEY` — σταθερό κλειδί για κρυπτογράφηση αποθηκευμένων API keys στη βάση
- Μεταβλητές ανά δίκτυο (AWIN, CJ, Impact, Webgains) όπως ορίζει το `backend/config.js`
- Προαιρετικό **Webgains**: `WEBGAINS_FORCE_ROW_CURRENCY=DKK` στο `backend/.env` — μετά το sync, το πεδίο `currency` στη βάση γίνεται πάντα DKK (όταν το report σου είναι DKK-scoped αλλά μερικά raw rows έχουν `EUR`). Τα ποσά παραμένουν με minor→major βάσει του ISO που διαβάζουμε από `value`/`commission`. Χρειάζεται **ξανά sync** για τις υπάρχουσες γραμμές.

Έναρξη dev (backend + frontend):

```bash
npm run dev
# ή ισοδύναμα:
npm run dev:stable
```

- Frontend: συνήθως **http://localhost:5173**
- Backend API: όπως ορίζεται στο `backend/server.js` (συνήθως port **3000** ή αντίστοιχο στο project)

Health check: `GET /api/health`

Production build frontend:

```bash
npm run build --prefix frontend
```

---

## Πώς να το ανεβάσεις στο GitHub

### 1. Δημιούργησε κενό repository στο GitHub

- GitHub → **New repository**
- Όνομα π.χ. `affiliate-merchant-tool`
- **Μην** προσθέσεις README / .gitignore / license από το UI αν θα κάνεις `git init` τοπικά με δικό σου README (για να μην έχεις conflict)· αλλιώς κάνε merge μετά.

### 2. Στον υπολογιστή σου (μέσα στο φάκελο του project)

```bash
cd "path/to/affiliate-tool-node-vue"

git init
git add .
git status   # έλεγξε ότι ΔΕΝ εμφανίζεται .env ούτε *.db ούτε node_modules
git commit -m "Initial commit: affiliate merchant tool (Vue + Node)"
git branch -M main
git remote add origin https://github.com/ΤΟ_USERNAME_SOU/affiliate-merchant-tool.git
git push -u origin main
```

Αν χρησιμοποιείς **SSH**:

```bash
git remote add origin git@github.com:ΤΟ_USERNAME_SOU/affiliate-merchant-tool.git
git push -u origin main
```

### 3. Αν ζητήσει login

- HTTPS: personal access token (GitHub → Settings → Developer settings → Fine-grained ή classic token) αντί για κωδικό.
- Ή εγκατάσταση [GitHub CLI](https://cli.github.com/) (`gh auth login`).

### 4. Αν το repository υπάρχει ήδη με README από το GitHub

```bash
git pull origin main --allow-unrelated-histories
# λύσε τυχόν conflicts, μετά:
git push -u origin main
```

---

## Αδειοδότηση / ιδιοκτησία

Ο κώδικας αναπτύχθηκε για **εσωτερική χρήση** στην εταιρεία μου. Αν το repo είναι **private**, καλύπτεσαι για εσωτερική ανάπτυξη· για **public** repo πρόσθεσε άδεια (LICENSE) και έλεγξε με τη νομική/HR αν επιτρέπεται δημοσίευση.

---

## Συντηρητής

Αναπτύχθηκε και συντηρείται από **[Manos lyrantzakis]** για λογαριασμό της εταιρείας.

*(Ενημέρωσε την παραπάνω γραμμή και το URL του remote όταν το στήσεις.)*
