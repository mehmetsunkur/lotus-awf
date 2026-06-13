FROM node:22-bookworm-slim

WORKDIR /app

EXPOSE 3000 3001

CMD ["npm", "run", "dev"]
