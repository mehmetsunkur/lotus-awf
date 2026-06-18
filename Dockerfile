FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "start"]
