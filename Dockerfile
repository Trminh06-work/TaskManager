# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --no-fund --no-audit

FROM deps AS test
COPY . .
ENV DB_PATH=:memory: \
    NODE_ENV=test
CMD ["npm", "run", "test:coverage"]

FROM node:22-alpine AS release
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
