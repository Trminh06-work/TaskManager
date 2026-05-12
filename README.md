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

## Next steps (later assignment phases)

- `Dockerfile` + `docker-compose.yml`
- `Jenkinsfile` (build → test → image → deploy)
- Monitoring (e.g., expose `/api/health` to Prometheus / uptime check)
