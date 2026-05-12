const client = require('prom-client');

client.collectDefaultMetrics();

const httpHist = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

function middleware(req, res, next) {
  const end = httpHist.startTimer();
  res.on('finish', () => {
    const route = (req.route && req.route.path)
      || (req.baseUrl ? req.baseUrl + (req.path === '/' ? '' : req.path) : req.path)
      || 'unknown';
    end({ method: req.method, route, code: String(res.statusCode) });
  });
  next();
}

async function metricsHandler(req, res) {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
}

function register(app) {
  app.use(middleware);
  app.get('/metrics', metricsHandler);
}

module.exports = { register, middleware, metricsHandler };
