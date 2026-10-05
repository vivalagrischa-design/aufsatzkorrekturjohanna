FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
ENV NODE_ENV=production PORT=3000 AI_PROVIDER=ollama
EXPOSE 3000
CMD ["npm", "start"]
