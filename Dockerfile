FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "src/server.js"]
