module.exports = {
  testEnvironment: 'node',
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'reports', outputName: 'junit.xml' }]
  ],
  collectCoverageFrom: [
    'server.js',
    'src/**/*.js',
    '!src/metrics.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'cobertura'],
  coverageThreshold: {
    global: { lines: 70, statements: 70, functions: 65, branches: 55 }
  }
};
