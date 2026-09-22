FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/sim/package.json packages/sim/
COPY apps/api/package.json apps/api/
RUN npm install --workspace=@duality/api --workspace=@duality/sim --include-workspace-root=false || npm install
COPY packages/sim packages/sim
COPY apps/api apps/api
WORKDIR /app/apps/api
CMD ["npx", "tsx", "src/index.ts"]
