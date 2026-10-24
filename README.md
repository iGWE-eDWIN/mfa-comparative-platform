# MFA Comparative Platform

A web-based comparative platform for benchmarking multi-factor authentication algorithms and protocols. It runs **HOTP** (RFC 4226), **TOTP** (RFC 6238), **OOB Email OTP** and **FIDO2/WebAuthn** (W3C Level 3, through a Virtual Authenticator) under identical, controlled conditions, shows progress live over Socket.IO, and presents side-by-side results that you can export as CSV or JSON.

Final-year Computer Science project. Built with MongoDB, Express.js, React and Node.js, plus Socket.IO. The design follows the project's Chapters 1–3 (kept out of this public repository); see [`docs/PLAN.md`](docs/PLAN.md) for the requirement → file → test traceability and [`docs/DECISIONS.md`](docs/DECISIONS.md) for every design decision and document conflict.

> **Honest limitations**
>
> - WebAuthn results come from a **software Virtual Authenticator** (Chrome DevTools Protocol), not hardware keys.
> - Biometrics are covered only through the WebAuthn user-verification abstraction.
> - Security tests are **controlled simulations** of defined scenarios, not penetration testing.
> - Email send time depends on the provider and the network. It is reported separately from server compute.
> - The AAL and security classification shown on the dashboard is **from the literature (Table 2.1), not measured**.

---

## 10-minute setup (no Docker)

**Requirements:** Node.js ≥ 20.12 (tested on 24.21), npm ≥ 10, and Google Chrome or Chromium (used for the WebAuthn benchmark). About 1 GB of disk space for dependencies and a MongoDB binary.

```bash
git clone <repo-url> mfa-platform && cd mfa-platform
npm install                     # installs server + client workspaces
cp .env.example .env            # defaults work for local development
npm run dev:db                  # terminal 1: MongoDB on 127.0.0.1:27017 (downloads mongod once)
npm run seed                    # terminal 2: admin, demo user and the four protocol definitions
npm run dev:all                 # API on :4000 + Vite client on :5173 (starts MongoDB itself if needed)
```

Open <http://localhost:5173> and sign in:

| Account       | Username | Password         |
| ------------- | -------- | ---------------- |
| Demo user     | `demo`   | `DemoPass#2026`  |
| Administrator | `admin`  | `AdminPass#2026` |

These are development defaults. Set `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` before seeding anything shared.

- Already have MongoDB? Set `MONGODB_URI` in `.env` and skip `npm run dev:db`.
- No Chrome or Chromium installed? Run `npm run browsers` to download Playwright's Chromium, or set `CHROMIUM_PATH`.
- **Single-port mode:** `npm run build`, then set `SERVE_CLIENT=true`, `WEBAUTHN_ORIGIN=http://localhost:4000`, `CLIENT_ORIGINS=http://localhost:4000`, run `npm start`, and open <http://localhost:4000>.

### Docker

```bash
cp .env.example .env    # fill JWT_SECRET, SECRETS_ENCRYPTION_KEY, OTP_HMAC_KEY, SEED_*_PASSWORD (production mode)
docker compose up --build
```

Open <http://localhost:8080>. The Compose file runs `mongo`, `server` (built on the Playwright image, which includes Chromium) and `client` (nginx, which proxies `/api` and `/socket.io`). _Docker was not available on the development machine, so the Compose path has not been verified there; the no-Docker path is the verified one (`docs/DECISIONS.md` D22)._

---

## Using the platform

The workflow follows Figure 3.6: **Login → Dashboard → New comparison → Live monitor → Results → History/Export**.

1. **New comparison:** select any of the four protocols, adjust their parameters, then set the iterations, warm-up, job timeout and per-operation timeout, and press **Run Comparison**.
2. **Live monitor:** shows Socket.IO events (`job:started`, `protocol:started`, `iteration:progress`, `protocol:completed`, `job:completed`, `job:failed`, `job:cancelled`) and lets you cancel the job.
3. **Results:**
   - side-by-side table
   - latency/processing charts (mean, median, p95, p99; linear or log)
   - per-protocol distributions, throughput, error rate, CPU and heap
   - security matrix with explanations and evidence
   - editable usability and integration assessments
   - the Table 2.1 literature panel
   - environment metadata
   - CSV/JSON export
4. **Simulators:** try each protocol by hand.
   - HOTP/TOTP enrolment with a QR code and an in-browser virtual token.
   - Email codes, delivered to Ethereal or to the local inbox.
   - WebAuthn registration and authentication. Use a real passkey, or Chrome DevTools → _More tools → WebAuthn → Enable virtual authenticator environment_.
5. **My factors:** choose one enrolled factor to require after your password at sign-in.
6. **Admin:** manage users (role, suspension), protocols (enable/disable, default parameters) and audit logs.

### Benchmark campaign (reproducing Chapter 4)

```bash
# with the API running in single-port mode (see above)
npm run campaign -- --runs=3 --iterations=1000 --warmup=50
```

This runs identical four-protocol jobs through the API and writes raw JSON/CSV exports plus `summary.json`/`summary.csv` (cross-run mean, SD and CV) to `docs/results/campaign-<timestamp>/`. `node scripts/screenshots.mjs` drives the UI and saves screenshots to `docs/screenshots/`.

---

## Deploying live on Render (free tier)

The repository includes a single-service `Dockerfile` (API + built client + Chromium) and a `render.yaml` Blueprint.

1. **MongoDB Atlas (free M0 cluster)**
   1. Sign up at <https://www.mongodb.com/cloud/atlas/register> and create a free **M0** cluster.
   2. Go to **Database Access → Add New Database User**. Use password authentication and save the username and password.
   3. Go to **Network Access → Add IP Address → Allow Access from Anywhere (`0.0.0.0/0`)**. Render's free instances have no fixed IP.
   4. Click **Connect → Drivers** and copy the connection string. Insert your password and a database name, for example `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/mfa_platform?retryWrites=true&w=majority`.
2. **Render**
   1. Sign in at <https://render.com> with GitHub.
   2. Choose **New → Blueprint** and select this repository. Render reads `render.yaml`.
   3. When prompted, enter `MONGODB_URI` (from step 1), `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD`.
   4. Click **Apply**. The first build takes several minutes because the Playwright base image is large.
3. Open `https://<service-name>.onrender.com` and sign in as `demo` or `admin` with the passwords you set.

Notes:

- **Generated configuration:** `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY` and `OTP_HMAC_KEY` are generated by Render. The WebAuthn origin and RP ID come from Render's `RENDER_EXTERNAL_URL` and `RENDER_EXTERNAL_HOSTNAME`, so you don't configure the URL anywhere.
- **Spin-down:** free instances spin down after about 15 minutes idle. The first request afterwards takes about a minute. A job that is running when the instance stops is marked _Failed (server restarted)_.
- **Resources:** 512 MB RAM and a shared CPU. `BENCHMARK_MAX_ITERATIONS` is set to 2,000, and live timings are much noisier than on a dedicated machine. Use the local setup for the reported campaign.
- **Email:** free hosting tiers commonly block outbound SMTP on ports 25/465/587. The app probes Ethereal's SMTP connection at start-up and falls back to the built-in local inbox, shown in the UI because `MAIL_TEST_INBOX_IN_UI=true`. For real delivery, set `MAIL_PROVIDER=brevo`, `BREVO_SMTP_PORT=2525`, the Brevo credentials and a verified `MAIL_FROM`, and remove `MAIL_TEST_INBOX_IN_UI`.
- **Demo setting:** with a test mailbox shown in the UI, OOB Email is a demonstration, not a real second factor.

---

## Email (OOB) providers

Set `MAIL_PROVIDER` in `.env`:

| Value                | Use                               | Notes                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ethereal` (default) | Development and benchmarks        | No signup. A test account is created automatically with `nodemailer.createTestAccount()` and cached in `server/.data/`. The UI shows the message preview link. If the Ethereal API or its SMTP port is unreachable (probed at start-up), the platform falls back to `local` (`MAIL_FALLBACK_LOCAL=true`) and records the fallback in every affected result. |
| `local`              | Offline / firewalled machines, CI | In-process SMTP sink on `127.0.0.1:LOCAL_SMTP_PORT` with STARTTLS. The development inbox is shown on the OOB simulator page. Nothing leaves the machine.                                                                                                                                                                                                    |
| `brevo`              | Real delivery, free tier          | `smtp-relay.brevo.com` on `BREVO_SMTP_PORT` (587 or 2525 with STARTTLS, or 465 with implicit TLS). See below.                                                                                                                                                                                                                                               |
| `gmail`              | Real delivery                     | Port 465 (implicit TLS) with an app password.                                                                                                                                                                                                                                                                                                               |
| `mailtrap`           | Sandbox inbox                     | `sandbox.smtp.mailtrap.io:2525`, STARTTLS required.                                                                                                                                                                                                                                                                                                         |

All real providers use `requireTLS` (or implicit TLS) with certificate validation, so a downgrade to plaintext SMTP fails instead of exposing the code (Chapter 2 §2.4.3.2). Credentials are only read from `.env`, which is git-ignored.

### Getting free Brevo SMTP credentials

1. Create a free account at <https://www.brevo.com> (the free plan includes a daily sending allowance; check Brevo's current limits).
2. Verify a sender: **Senders, Domains & Dedicated IPs → Senders → Add a sender**, then confirm the email Brevo sends you.
3. Open **SMTP & API → SMTP** and click **Generate a new SMTP key**. Copy the key; it is shown only once.
4. On the same page, note the **Login** (an address like `xxxxxx@smtp-brevo.com`).
5. Put these in `.env`:
   ```env
   MAIL_PROVIDER=brevo
   BREVO_SMTP_USER=<the SMTP login>
   BREVO_SMTP_KEY=<the SMTP key>
   MAIL_FROM="MFA Platform <your-verified-sender@example.com>"
   ```
6. Restart the API. Check the **System status** card on the dashboard, then send a code from _Simulators → OOB Email_.

To protect the free quota, benchmark jobs that would send more than `BREVO_MAX_BENCH_EMAILS` (default 50) emails through Brevo are refused. Use `ethereal` or `local` for large runs.

**Gmail:** enable 2-Step Verification, create an app password at <https://myaccount.google.com/apppasswords>, and set `GMAIL_USER` and `GMAIL_APP_PASSWORD`.

---

## Tests

```bash
npm test             # server unit + integration (mongodb-memory-server), client tests
npm run test:e2e     # builds the client, then E2E WebAuthn through the real UI with a CDP virtual authenticator
npm run coverage     # all server projects with V8 coverage
npm run lint
```

- **Unit:** RFC 4226 Appendix D and RFC 6238 Appendix B vectors, crypto, statistics, the four modules, the benchmark runner, security simulations, export, assessments and mail providers.
- **Integration:** auth, lockout and rate limiting; simulators and second-factor login; jobs, state machine, cancellation and timeout; Chapter 3 indexes; Socket.IO isolation; admin; audit.
- **E2E:** WebAuthn module ceremonies, origin-binding simulations, and registration plus passkey sign-in through the UI.

---

## Architecture

```
client/  React + Vite (presentation tier)
server/  Node.js + Express (logic tier)            MongoDB (data tier)
  src/routes → controllers → services → protocols → models
  src/protocols/{hotp,totp,oobEmail,webauthn}   common interface:
      configure() initialize() execute() verify() collectMetrics() reset()
  src/services/benchmark/   benchmarkService (queue, Figure 3.4 state machine, Socket.IO relay)
                            worker.js (worker_threads isolation) · runner.js (identical procedure)
  src/services/securitySimulationService.js   phishing, replay, brute force, expiry, desync
  src/services/{authService,auditService,exportService,assessmentService,environmentService}.js
  src/services/mail/        provider abstraction + local SMTP sink
scripts/   dev-mongo, dev-all, campaign, screenshots
docs/      PLAN, DECISIONS, openapi.yaml, results (campaign data, test reports), screenshots
```

**Collections:** the five Chapter 3 collections (`users`, `protocols`, `comparison_jobs`, `results`, `audit_logs`) with the §3.9.4 indexes, plus three documented extension collections (`credentials`, `otp_challenges` with a TTL index, and `webauthn_challenges` with a TTL index); see D04.

**Security:**

- bcrypt (cost 12) password hashing.
- httpOnly `SameSite=Strict` session cookie, with `Secure` in production.
- Role-based access, and owner-only access to jobs and results.
- Helmet with a CSP, a CORS allow-list, and a JSON-only check on state-changing requests.
- `express-rate-limit`, plus account and factor lockout.
- Zod validation everywhere and a centralised error handler.
- AES-256-GCM for OTP secrets at rest.
- HMAC-SHA-256 with a per-record salt for email codes.
- `crypto.timingSafeEqual` comparisons.
- Pino log redaction, and audit-detail scrubbing so codes, secrets and passwords are never logged.

## Troubleshooting

| Symptom                                                        | Fix                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `No Chromium found` when a WebAuthn job starts                 | `npm run browsers`, or set `CHROMIUM_PATH`                                                                                |
| WebAuthn simulator fails with `SecurityError`                  | `WEBAUTHN_ORIGIN` must exactly match the address in the browser bar (`http://localhost:5173` in dev, `:4000` single-port) |
| OOB Email shows "Ethereal unavailable … using local SMTP sink" | Your network blocks Ethereal. Use the local inbox, or configure `brevo`/`gmail`/`mailtrap`                                |
| `MongoServerSelectionError`                                    | Start `npm run dev:db` or fix `MONGODB_URI`                                                                               |
| Port 5173/4000 in use                                          | Stop the other process, or change `PORT` and the Vite port                                                                |
