FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/event-indexer/package.json ./packages/event-indexer/package.json
RUN npm ci --omit=dev
COPY packages/event-indexer ./packages/event-indexer
WORKDIR /app/packages/event-indexer
ENV NODE_ENV=production
CMD ["npm", "start"]
