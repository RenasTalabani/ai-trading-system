FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p logs

EXPOSE 5000

USER node
CMD ["node", "server.js"]
