FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @nexo/contracts && npm run build -w @nexo/api

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@nexo/api --include-workspace-root=false && npm cache clean --force
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --chown=node:node apps/api/migrations migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=4s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh","-c","node apps/api/dist/migrate.js && exec node apps/api/dist/server.js"]
