# Task Manager — SIT223 HD Prototype

Localhost-ready Node.js web app for the CI/CD Jenkins pipeline assignment. Includes user authentication, task CRUD, and a JSON API — designed to be built, tested, dockerized, and deployed by Jenkins in later steps.

## Stack
- Node.js (>=18) + Express
- SQLite (`better-sqlite3`) — single-file DB, no extra service
- EJS server-rendered views + responsive CSS
- bcryptjs + express-session for authentication
- Jest + Supertest for testing

## Quick start

```bash
npm install
npm start
# → http://localhost:3000
```

First visit redirects to `/login`. Register a new account, then create tasks.

## Tests

```bash
npm test
```

Tests run against an in-memory SQLite DB (`DB_PATH=:memory:`) so they leave no artifacts on disk — Jenkins can invoke `npm test` directly.

## Project layout

```
server.js              app factory + entry point
src/
  db.js                sqlite connection + schema
  middleware/auth.js   session-gated route guard
  routes/auth.js       /login, /register, /logout (form)
  routes/tasks.js      /tasks UI (server-rendered)
  routes/api.js        /api/health + /api/tasks JSON API
views/                 EJS templates
public/style.css       responsive styling
tests/                 Jest + Supertest suite
```

## API surface

| Method | Path                | Auth | Purpose            |
|--------|---------------------|------|--------------------|
| GET    | `/api/health`       | no   | Liveness probe     |
| GET    | `/api/tasks`        | yes  | List own tasks     |
| GET    | `/api/tasks/:id`    | yes  | Read one           |
| POST   | `/api/tasks`        | yes  | Create             |
| PUT    | `/api/tasks/:id`    | yes  | Update             |
| DELETE | `/api/tasks/:id`    | yes  | Delete             |

## Environment variables

| Variable          | Default              | Notes                          |
|-------------------|----------------------|--------------------------------|
| `PORT`            | `3000`               | HTTP listen port               |
| `DB_PATH`         | `./data/app.db`      | Use `:memory:` for tests       |
| `SESSION_SECRET`  | dev fallback         | Set a real value in production |

## CI/CD pipeline

A complete 7-stage Jenkins pipeline is defined in `Jenkinsfile`:

1. **Build** — multi-stage Docker build (`Dockerfile`), tags `${BUILD_NUMBER}-${git-sha}`
2. **Test** — runs Jest in the test-stage image; publishes JUnit + Cobertura reports to Jenkins
3. **Code Quality** — SonarCloud scan via `sonarsource/sonar-scanner-cli`, blocks on quality gate
4. **Security** — parallel `npm audit` (deps) + `trivy` (image), fails on HIGH/CRITICAL
5. **Deploy** — `docker compose -f infra/docker-compose.staging.yml up -d` → smoke `:3001/api/health`, auto-rollback on failure
6. **Release** — only on `main`: multi-arch `docker buildx` push to Docker Hub, deploy production `:3000`, git-tag commit
7. **Monitoring** — verify `/metrics` is scraped by Prometheus, generate traffic for dashboards

### One-time setup

```bash
# 1. Bring up Jenkins. The custom image (infra/jenkins/Dockerfile) bakes in
#    docker-ce-cli + buildx + compose + git, so no runtime apt-get is needed.
docker compose -f infra/docker-compose.jenkins.yml up -d --build

# 2. Bring up Prometheus + Grafana + Alertmanager
docker compose -f infra/docker-compose.monitoring.yml up -d
# Grafana:      http://localhost:3030  (anon Viewer + admin/admin)
# Prometheus:   http://localhost:9090
# Alertmanager: http://localhost:9093
```

**Inside Jenkins** install plugins: *Docker Pipeline, SonarQube Scanner, Cobertura, JUnit, Pipeline: Utility Steps, Credentials Binding*. Add credentials:

| ID | Type | Value |
|----|------|-------|
| `github-pat` | Username + Password | GitHub username + PAT (scope: `repo`) |
| `dockerhub-creds` | Username + Password | Docker Hub username + access token |
| `sonarcloud-token` | Secret text | Token from sonarcloud.io |

Configure *Manage Jenkins → System → SonarQube servers*: name `SonarCloud`, URL `https://sonarcloud.io`, credential `sonarcloud-token`.

Create a Pipeline job pointing at the GitHub repo, branch `main`, "Pipeline script from SCM" → `Jenkinsfile`.

### Updating `IMAGE_NAME`

Edit `Jenkinsfile` line `IMAGE_NAME = 'trminh06/taskmanager'` to match your Docker Hub repo.

### Architecture note

All images are multi-arch (arm64 + amd64). For native speed on Apple Silicon, do **not** pass `--platform linux/amd64` when starting Jenkins. The Release stage's `docker buildx` produces a multi-arch manifest so the published image runs on any host.

### Incident simulation

To demonstrate alerting:

```bash
docker stop taskmanager-production
# Wait ~1 minute, then check Alertmanager UI: http://localhost:9093
# Should see AppDown alert firing for env=production
docker start taskmanager-production
# Alert auto-resolves
```
