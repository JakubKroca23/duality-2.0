# Build context: repo root
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@duality/api --workspace=@duality/sim --include-workspace-root=false

COPY packages/sim packages/sim
COPY apps/api apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "src/index.ts"]
