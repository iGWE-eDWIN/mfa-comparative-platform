# Implementation Plan and Traceability Matrix

Source of truth: `docs/text/*.txt` (extracted from `docs/source/*.docx`) and `docs/figures/fig3.*.png`.
Decisions and conflicts: `docs/DECISIONS.md`.

## Sprints (Chapter 3 §3.2.3)

| Sprint | Scope                                                     | Main outputs                                                                                                   |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0      | Read docs, plan                                           | `docs/PLAN.md`, `docs/DECISIONS.md`                                                                            |
| 1      | Repo, tooling, env, Docker, MongoDB, UI shell             | workspaces, ESLint/Prettier, `.env.example`, `docker-compose.yml`, `server/src/models/*`, `client/src/App.jsx` |
| 2      | Registration, login, sessions, roles, audit               | `server/src/services/authService.js`, `middleware/auth.js`, `services/auditService.js`                         |
| 3      | HOTP + TOTP                                               | `server/src/protocols/hotp/`, `protocols/totp/`, `lib/otp.js` + RFC vector tests                               |
| 4      | OOB Email                                                 | `protocols/oobEmail/`, `services/mail/*` (ethereal, brevo, gmail, mailtrap, local)                             |
| 5      | WebAuthn                                                  | `protocols/webauthn/`, `services/webauthnService.js`, `lib/virtualAuthenticator.js`                            |
| 6      | Benchmark, state machine, Socket.IO, security simulations | `services/benchmark/*`, `services/securitySimulationService.js`, `services/socketManager.js`                   |
| 7      | Dashboard, history, export, admin                         | `client/src/pages/*`, `services/exportService.js`                                                              |
| 8      | Tests, benchmark campaign                                 | `scripts/campaign.mjs`, `docs/results/*`                                                                       |
| 9      | Docs                                                      | `README.md`, `docs/openapi.yaml`, `docs/CHAPTER4_DRAFT.md`, `docs/CHAPTER5_DRAFT.md`                           |
| 10     | Fresh-clone verification                                  | `scripts/verify-fresh-clone.sh`                                                                                |

## Functional requirements

| FR   | Requirement                                      | Server                                                                                             | Client                                                            | Tests                                                                                 |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| FR1  | Register/authenticate securely                   | `routes/index.js`, `controllers/authController.js`, `services/authService.js`, `middleware/auth.js` | `pages/Login.jsx`, `pages/Register.jsx`, `pages/MfaChallenge.jsx` | `tests/integration/auth.test.js`, `tests/integration/simulatorAndMfa.test.js`, `tests/e2e/ui.e2e.test.js`                    |
| FR2  | Select protocols                                 | `validation/schemas.js`, `protocols/ProtocolManager.js`                                         | `pages/Configure.jsx`                                             | `tests/integration/jobs.test.js`                                                      |
| FR3  | Protocol parameters                              | `protocols/*/schema.js`, `models/Protocol.js` (defaultConfig)                                      | `pages/Configure.jsx` (`ParamInput`)                                   | `tests/unit/protocols.test.js`                                                  |
| FR4  | Execute the four flows                           | `protocols/{hotp,totp,oobEmail,webauthn}/index.js`, `routes/index.js`                          | `pages/simulators/*.jsx`                                          | `tests/unit/protocols.test.js`, `tests/unit/otp.test.js`, `tests/integration/simulatorAndMfa.test.js`, `tests/e2e/webauthnModule.e2e.test.js` |
| FR5  | Processing time, latency, throughput, error rate | `services/benchmark/runner.js`, `lib/stats.js`                                                     | `pages/Results.jsx`                                               | `tests/unit/stats.test.js`, `tests/unit/runner.test.js`                               |
| FR6  | Simulated security checks                        | `services/securitySimulationService.js`                                                            | `components/SecurityMatrix.jsx`                                   | `tests/unit/securitySimulation.test.js`, `tests/e2e/webauthnModule.e2e.test.js`                                               |
| FR7  | Real-time progress (Socket.IO)                   | `services/socketManager.js`, `services/benchmark/benchmarkService.js`                              | `hooks/useJobSocket.js`, `pages/Monitor.jsx`                      | `tests/integration/socketAndAdmin.test.js`                                                    |
| FR8  | Store jobs, configs, results                     | `models/ComparisonJob.js`, `models/Result.js`                                                      | —                                                                 | `tests/integration/jobs.test.js`, `tests/integration/indexes.test.js`                 |
| FR9  | Side-by-side comparison                          | `services/jobService.js` (`jobResults`)                                                                    | `pages/Results.jsx`, `components/charts/*`                        | `tests/integration/jobs.test.js`                                                      |
| FR10 | History + CSV/JSON export                        | `services/exportService.js`, `routes/index.js`                                                      | `pages/History.jsx`                                               | `tests/unit/services.test.js`, `tests/integration/jobs.test.js`                                       |
| FR11 | Audit events                                     | `services/auditService.js`, `models/AuditLog.js`                                                   | `pages/admin/AuditLogs.jsx`                                       | `tests/integration/socketAndAdmin.test.js`                                                     |
| FR12 | Usability/integration observations               | `services/assessmentService.js`, `routes/index.js`                                               | `components/AssessmentEditor.jsx`                                 | `tests/unit/services.test.js`, `tests/integration/jobs.test.js`                                                |

## Non-functional requirements

| NFR             | Implementation                                                                                                                                                  | Verification                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Security        | bcryptjs (12), httpOnly JWT cookie, RBAC, owner checks, Helmet, CORS allow-list, express-rate-limit, Zod, AES-256-GCM secrets, `timingSafeEqual`, log redaction | `auth.test.js`, `rateLimit.test.js`, `crypto.test.js`, `simulatorAndMfa.test.js`        |
| Performance     | Benchmarks run in `worker_threads` (`services/benchmark/worker.js`)                                                                                             | `socketAndAdmin.test.js` checks the API still responds during a job |
| Usability       | Figure 3.6 flow, clear states, inline validation                                                                                                                | Manual review recorded in Chapter 4                         |
| Maintainability | `ProtocolModule` base + one folder per protocol, registry in `ProtocolManager`                                                                                  | Lint, unit tests                                            |
| Scalability     | Stateless API, job queue, indexes, protocol registry                                                                                                            | `indexes.test.js`                                           |
| Reproducibility | `services/environmentService.js` stores Node/OS/CPU/library versions and settings on every job                                                                  | `jobs.test.js`                                              |
| Availability    | Job timeouts, Failed state with message, React error boundary, API error envelope                                                                               | `runner.test.js`, `jobs.test.js`                            |

## Metrics (§3.8.2)

| Metric                | Where computed                                              | Stored at                                                                                      |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Processing time       | Module server-side `hrtime`                                 | `results.metrics.processingTime{mean,median,p95,p99,min,max,stdDev}` + `rawSamples.processing` |
| Latency               | Runner around execute+verify                                | `results.metrics.latency{…}` + `rawSamples.latency`                                            |
| Throughput            | successful / measured wall seconds; successful / iterations | `results.metrics.throughput{opsPerSec,successfulOps,iterations}`                               |
| Error rate            | failed / attempted                                          | `results.metrics.errorCount`, `errorRate`                                                      |
| Resource observations | thread CPU time, heap delta, RSS, event-loop utilisation    | `results.metrics.resources`                                                                    |
| Integration effort    | rubric + measured LOC/dependencies                          | `results.integrationAssessment`                                                                |
| Usability             | rubric, editable                                            | `results.usabilityAssessment`                                                                  |
| Security outcome      | Security Simulation Service                                 | `results.securityOutcome`                                                                      |

## Figures

| Figure                      | Realised by                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1.1 High-level architecture | UI (client), Protocol Engine (`protocols/`), Benchmark Service, Results Dashboard                                   |
| 3.1 Use case                | User routes (`/api/auth`, `/api/jobs`, `/api/simulator`) and Admin routes (`/api/admin/*`)                          |
| 3.2 Sequence                | `POST /api/jobs` → validate → `ProtocolManager` → `benchmarkService` → worker → Socket.IO → Mongo → client          |
| 3.3 Activity                | `runner.js` steps: validate → execute → measure → security sims → assessment → aggregate → store                    |
| 3.4 State                   | `models/ComparisonJob.js` `JOB_TRANSITIONS` + `benchmarkService.transition()`                                       |
| 3.5 Three-tier              | `client/` · `server/` · MongoDB                                                                                     |
| 3.6 UI flow                 | `client/src/App.jsx` routes: `/login` → `/` → `/configure` → `/jobs/:id/monitor` → `/jobs/:id/results` → `/history` |

## Status (final)

All sprints were completed. Final test run: 148 tests passed (server 82 unit + 54 integration + 6 E2E; client 6), with 93.7% line coverage of server code (`docs/results/test-report-*.txt`, `docs/results/coverage-summary.json`). Campaign data are in `docs/results/campaign-*`, `docs/results/ablation-*`; chapter drafts are `docs/CHAPTER4_DRAFT.md` (built by `scripts/build-chapters.mjs`) and `docs/CHAPTER5_DRAFT.md`.

Files that differ from the plan above: no separate `comparisonService.js` (comparison and histogram logic is in `jobService.js`); simulator controllers are in `controllers/simulatorController.js` with services `otpCredentialService.js`, `oobService.js` and `webauthnService.js`; the client simulator pages are `pages/simulators/{Simulators,OtpSimulator,OobSimulator,WebAuthnSimulator}.jsx`.
