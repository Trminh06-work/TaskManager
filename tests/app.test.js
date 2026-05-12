process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { createApp } = require('../server');
const { getDb } = require('../src/db');

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM tasks; DELETE FROM users;');
});

async function registerAgent(username = 'alice', password = 'pass123') {
  const agent = request.agent(app);
  await agent.post('/register').type('form').send({ username, password });
  return agent;
}

describe('Health', () => {
  test('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('Auth', () => {
  test('register then access tasks page', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/register').type('form')
      .send({ username: 'alice', password: 'pass123' });
    expect(reg.status).toBe(302);
    expect(reg.headers.location).toBe('/tasks');

    const tasksRes = await agent.get('/tasks');
    expect(tasksRes.status).toBe(200);
    expect(tasksRes.text).toContain('Task Manager');
  });

  test('rejects duplicate username', async () => {
    await request(app).post('/register').type('form')
      .send({ username: 'bob', password: 'pass123' });
    const res = await request(app).post('/register').type('form')
      .send({ username: 'bob', password: 'pass123' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('already taken');
  });

  test('rejects short password', async () => {
    const res = await request(app).post('/register').type('form')
      .send({ username: 'shorty', password: 'ab' });
    expect(res.status).toBe(400);
  });

  test('login with correct credentials succeeds', async () => {
    await request(app).post('/register').type('form')
      .send({ username: 'carol', password: 'pass123' });
    const agent = request.agent(app);
    const res = await agent.post('/login').type('form')
      .send({ username: 'carol', password: 'pass123' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/tasks');
  });

  test('login with wrong password fails', async () => {
    await request(app).post('/register').type('form')
      .send({ username: 'carol', password: 'pass123' });
    const res = await request(app).post('/login').type('form')
      .send({ username: 'carol', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('logout clears session', async () => {
    const agent = await registerAgent('dave');
    const logout = await agent.post('/logout');
    expect(logout.status).toBe(302);
    const tasks = await agent.get('/tasks');
    expect(tasks.status).toBe(302);
    expect(tasks.headers.location).toBe('/login');
  });

  test('unauthenticated /tasks redirects to /login', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('unauthenticated /api/tasks returns 401 JSON', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('Task CRUD API', () => {
  let agent;

  beforeEach(async () => {
    agent = await registerAgent('owner');
  });

  test('create task returns 201 with body', async () => {
    const res = await agent.post('/api/tasks')
      .send({ title: 'Buy milk', description: 'whole milk' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Buy milk');
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBeDefined();
  });

  test('create task rejects empty title', async () => {
    const res = await agent.post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  test('list returns only own tasks', async () => {
    await agent.post('/api/tasks').send({ title: 'A' });
    await agent.post('/api/tasks').send({ title: 'B' });

    const otherAgent = await registerAgent('stranger');
    await otherAgent.post('/api/tasks').send({ title: 'Other' });

    const mine = await agent.get('/api/tasks');
    expect(mine.body).toHaveLength(2);
    expect(mine.body.map(t => t.title).sort()).toEqual(['A', 'B']);
  });

  test('get task by id', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Find me' });
    const res = await agent.get(`/api/tasks/${c.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Find me');
  });

  test('update task', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Old' });
    const u = await agent.put(`/api/tasks/${c.body.id}`)
      .send({ title: 'New', status: 'done' });
    expect(u.status).toBe(200);
    expect(u.body.title).toBe('New');
    expect(u.body.status).toBe('done');
  });

  test('update only description via dedicated endpoint', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Keep title', description: 'old' });
    const res = await agent.put(`/api/tasks/${c.body.id}/description`)
      .send({ description: 'new description' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Keep title');
    expect(res.body.description).toBe('new description');
  });

  test('description endpoint rejects missing field', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'X' });
    const res = await agent.put(`/api/tasks/${c.body.id}/description`).send({});
    expect(res.status).toBe(400);
  });

  test('description endpoint 404 for other users task', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Mine' });
    const otherAgent = await registerAgent('intruder');
    const res = await otherAgent.put(`/api/tasks/${c.body.id}/description`)
      .send({ description: 'hax' });
    expect(res.status).toBe(404);
  });

  test('delete task', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Tmp' });
    const d = await agent.delete(`/api/tasks/${c.body.id}`);
    expect(d.status).toBe(204);
    const list = await agent.get('/api/tasks');
    expect(list.body).toHaveLength(0);
  });

  test('cannot access another users task', async () => {
    const c = await agent.post('/api/tasks').send({ title: 'Secret' });
    const otherAgent = await registerAgent('eve');
    const res = await otherAgent.get(`/api/tasks/${c.body.id}`);
    expect(res.status).toBe(404);
    const upd = await otherAgent.put(`/api/tasks/${c.body.id}`).send({ title: 'Hijack' });
    expect(upd.status).toBe(404);
    const del = await otherAgent.delete(`/api/tasks/${c.body.id}`);
    expect(del.status).toBe(404);
  });
});

describe('Task UI forms', () => {
  test('toggle flips status', async () => {
    const agent = await registerAgent('toggler');
    const c = await agent.post('/api/tasks').send({ title: 'Flip me' });
    await agent.post(`/tasks/${c.body.id}/toggle`);
    const after = await agent.get(`/api/tasks/${c.body.id}`);
    expect(after.body.status).toBe('done');
    await agent.post(`/tasks/${c.body.id}/toggle`);
    const back = await agent.get(`/api/tasks/${c.body.id}`);
    expect(back.body.status).toBe('pending');
  });
});
