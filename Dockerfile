FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY templates ./templates

RUN npm run build

ENV NODE_ENV=production

# 3001 = Express API/app (default CMD). 3002 = MCP-over-HTTP host when the same
# image is run with `npm run mcp:http` (e.g. the k8s app-pod sidecar).
EXPOSE 3001 3002

CMD ["npm", "start"]
