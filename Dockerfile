FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/fdc-scripts/package.json ./packages/fdc-scripts/package.json
COPY packages/fcc-extension/typescript/package.json ./packages/fcc-extension/typescript/package.json
COPY packages/event-indexer/package.json ./packages/event-indexer/package.json
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
ARG NEXT_PUBLIC_BASE_GUARD_MANAGER
ARG NEXT_PUBLIC_BASE_PROTECTION_VAULT
ARG NEXT_PUBLIC_BASE_APPROVED_TOKEN
ARG NEXT_PUBLIC_AVERLOCK_INDEXER_URL

ENV NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=$NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL \
    NEXT_PUBLIC_BASE_GUARD_MANAGER=$NEXT_PUBLIC_BASE_GUARD_MANAGER \
    NEXT_PUBLIC_BASE_PROTECTION_VAULT=$NEXT_PUBLIC_BASE_PROTECTION_VAULT \
    NEXT_PUBLIC_BASE_APPROVED_TOKEN=$NEXT_PUBLIC_BASE_APPROVED_TOKEN \
    NEXT_PUBLIC_AVERLOCK_INDEXER_URL=$NEXT_PUBLIC_AVERLOCK_INDEXER_URL

RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/.next ./apps/web/.next
EXPOSE 3000
CMD ["npm", "run", "start"]
