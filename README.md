# Task Manager — SIT223 HD

A Node.js + Express prototype built for the SIT223 HD CI/CD task. The app is a small task manager with user login, task CRUD, and a JSON API. It runs on localhost via Docker, and a Jenkins pipeline (also on localhost) builds, tests, scans, deploys, and monitors it.

## Stack

- Node.js 22 + Express
- SQLite via Node's built-in `node:sqlite` module (no native build step)
- EJS server-rendered views + plain CSS for the UI
- bcryptjs + express-session for auth
- prom-client for Prometheus metrics
- Jest + Supertest + jest-junit for tests

## Run it locally

```bash
npm install
npm start
# http://localhost:3000
```

First visit redirects to `/login`. Register an account, then create tasks. The "Edit" link beside each task description uses `PUT /api/tasks/:id/description` over fetch — visible in DevTools Network without a page reload.

## Tests

```bash
npm test            # 20 tests, ~1.5s
```

Tests use an in-memory DB (`DB_PATH=:memory:`) so nothing is written to disk. Jest is configured with coverage thresholds (70% lines / 65% functions / 55% branches) in [`jest.config.js`](jest.config.js) — drop below and the test stage fails.

## Repo layout

```
server.js                       app entry + express setup
src/
  db.js                         sqlite connection + schema
  metrics.js                    prom-client middleware + /metrics handler
  middleware/auth.js            session-gated route guard
  routes/auth.js                /login, /register, /logout
  routes/tasks.js               /tasks UI (server-rendered)
  routes/api.js                 /api/health, /api/tasks, /api/tasks/:id/description
views/                          EJS templates
public/
  style.css                     responsive styling, mobile breakpoint at 600px
  app.js                        vanilla JS for the edit/delete UX
tests/app.test.js               20 Jest + Supertest tests

Dockerfile                      multi-stage: deps → test → release (npm stripped)
.dockerignore
jest.config.js                  JUnit + Cobertura reporters + coverage thresholds
sonar-project.properties        SonarCloud project key, org, lcov path

Jenkinsfile                     the 7-stage pipeline
infra/
  jenkins/Dockerfile            Jenkins LTS + docker-ce-cli + buildx + compose + git
  docker-compose.jenkins.yml
  docker-compose.monitoring.yml
  docker-compose.staging.yml
  docker-compose.production.yml
  prometheus/{prometheus.yml,alerts.yml}
  alertmanager/alertmanager.yml
  grafana/provisioning/...      datasource + pre-built dashboard
```

## API

| Method | Path                                | Auth | Notes |
|--------|-------------------------------------|------|-------|
| GET    | `/api/health`                       | no   | liveness probe — used by Dockerfile HEALTHCHECK and the pipeline |
| GET    | `/metrics`                          | no   | Prometheus exposition format, default Node metrics + `http_request_duration_seconds` histogram |
| GET    | `/api/tasks`                        | yes  | list own tasks |
| GET    | `/api/tasks/:id`                    | yes  | read one |
| POST   | `/api/tasks`                        | yes  | create |
| PUT    | `/api/tasks/:id`                    | yes  | full update |
| PUT    | `/api/tasks/:id/description`        | yes  | description only — what the UI's inline edit calls |
| DELETE | `/api/tasks/:id`                    | yes  | delete |

All `/api/tasks*` routes scope by `user_id`, so one account never sees or touches another's tasks. Covered by the `cannot access another users task` test.

## Environment variables

| Variable          | Default              | Notes |
|-------------------|----------------------|-------|
| `PORT`            | `3000`               | HTTP listen port |
| `DB_PATH`         | `./data/app.db`      | `:memory:` for tests |
| `SESSION_SECRET`  | dev fallback         | override in production — don't ship the default |

---

## CI/CD pipeline

7 stages in [`Jenkinsfile`](Jenkinsfile). Pass/fail gated — a failing stage halts the pipeline.

1. **Build** — `docker build` of two Dockerfile targets: `release` (slim runtime, npm and corepack stripped out) and `test` (with dev deps). Tagged `<image>:<BUILD_NUMBER>-<sha>` and `<image>:ci`.
2. **Test** — runs Jest inside the test image using the Docker Pipeline plugin's `docker.image().inside { }`. Coverage thresholds enforced. JUnit + Cobertura reports archived to Jenkins.
3. **Code Quality** — `sonarsource/sonar-scanner-cli` uploads source + `coverage/lcov.info` to SonarCloud. `waitForQualityGate abortPipeline: true` blocks on the gate.
4. **Security** — two parallel scans:
   - `npm audit --audit-level=high` fails on HIGH/CRITICAL deps
   - `trivy image --severity HIGH,CRITICAL --ignore-unfixed --scanners vuln` scans the built image. `--ignore-unfixed` filters out base-image CVEs with no upstream fix, so the gate only blocks on actionable findings.
5. **Deploy: staging** — `docker compose -p taskmanager-staging up -d` on port `3001`. Health-checked via `docker exec taskmanager-staging wget …` (no `host.docker.internal` needed). `post.failure` auto-rolls-back to the previous image tag.
6. **Release** — only on `main`: `docker buildx build --platform linux/amd64,linux/arm64 --push` to Docker Hub with tags `v0.1.<BUILD_NUMBER>`, `latest`, and `<BUILD_NUMBER>-<sha>`. Then deploys to `taskmanager-production` on port `3000`, and pushes a git tag back to GitHub.
7. **Monitoring** — runs `docker exec` against `taskmanager-production` and `prometheus` to verify metrics are exposed, Prometheus is ready, and scrape targets are `up`. Generates 20 hits to `/api/health` so dashboards have non-zero traffic.

### Project-scoped compose

Each compose call uses `-p <project>` so `--remove-orphans` can't kill containers from a different compose file. Jenkins + monitoring keep the default project name; staging and production each get their own:

| Project | Contains |
|---|---|
| `infra` (default) | Jenkins, Prometheus, Grafana, Alertmanager |
| `taskmanager-staging` | staging app on `:3001` |
| `taskmanager-production` | production app on `:3000` |

---

## Bring up Jenkins and monitoring

```bash
# Custom Jenkins image bakes in docker-ce-cli + buildx + compose + git
docker compose -f infra/docker-compose.jenkins.yml up -d --build

# Prometheus + Grafana + Alertmanager
docker compose -f infra/docker-compose.monitoring.yml up -d
```

After they're up:

- Jenkins http://localhost:8080 — initial password: `docker exec TaskManager cat /var/jenkins_home/secrets/initialAdminPassword`
- Grafana http://localhost:3030 — admin / admin, dashboard "Task Manager — Overview" is pre-provisioned
- Prometheus http://localhost:9090
- Alertmanager http://localhost:9093

### Jenkins setup

Run through the wizard, install **Suggested plugins**, then add two more:
- Docker Pipeline (for `docker.image().inside { }`)
- SonarQube Scanner for Jenkins (for `withSonarQubeEnv` and `waitForQualityGate`)

Add credentials under Manage Jenkins → Credentials → System → Global. IDs are referenced by name in the Jenkinsfile — must match exactly:

| ID | Type | Value |
|----|------|-------|
| `sonarcloud-token` | Secret text | SonarCloud token |
| `dockerhub-creds` | Username + password | Docker Hub username + access token (Read + Write + Delete scope) |
| `github-pat` | Username + password | GitHub username + PAT (`repo` scope) |

Then Manage Jenkins → System → **SonarQube servers** → Add:
- Name: `SonarCloud` (exact — matches the string in [`Jenkinsfile:57`](Jenkinsfile#L57))
- URL: `https://sonarcloud.io`
- Server authentication token: pick `sonarcloud-token`

### Pipeline job

New Item → **Pipeline** (not Multibranch). Name it **without spaces** — Docker bind-mount paths break on spaces, and you'll waste a build cycle finding out.

- Pipeline definition: **Pipeline script from SCM** → Git → your repo → branch `main` → Script Path `Jenkinsfile`

### Tweak for your accounts

Edit three identifiers to match yours before pushing:

| File | Field | Set to |
|---|---|---|
| [`Jenkinsfile`](Jenkinsfile) | `IMAGE_NAME` | `<your-dockerhub-user>/taskmanager` |
| [`sonar-project.properties`](sonar-project.properties) | `sonar.projectKey` | as shown on your SonarCloud project page |
| [`sonar-project.properties`](sonar-project.properties) | `sonar.organization` | your SonarCloud org key |

### Multi-arch note

The Release stage's `docker buildx` produces a multi-arch image (arm64 + amd64), so the published image runs on Apple Silicon, Intel Mac, and any cloud host. The Jenkins container itself can run on either arch — pick whichever matches your Mac for native speed.

---

## Demo

```bash
# 1. Push a commit → Jenkins picks it up (Build Now if not using webhook)
# 2. Open http://localhost:3000 → register → add a task
# 3. DevTools Network tab → click Edit on a description
#    → PUT /api/tasks/N/description shows up without page reload
# 4. Open Grafana (http://localhost:3030) → "Task Manager — Overview" dashboard
#    → request rate climbs as you click around the app
```

### Incident simulation

```bash
docker stop taskmanager-production
# wait ~60s, check Alertmanager: http://localhost:9093
# AppDown alert should be firing for env=production
docker start taskmanager-production
# alert auto-resolves
```
