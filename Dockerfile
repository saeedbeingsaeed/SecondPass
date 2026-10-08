# Build stage: install everything and compile TypeScript.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY eval ./eval
RUN npm run build

# Runtime stage: production dependencies and compiled code only.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# app.yml is read by Probot; the schema is kept for reference.
COPY app.yml ./
COPY src/db/schema.sql ./src/db/schema.sql

# Run as the unprivileged "node" user that the base image provides.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/ping || exit 1
CMD ["node", "dist/src/index.js"]
