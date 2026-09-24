FROM node:24-alpine
WORKDIR /app/llama-bot
COPY bot-lib/package.json bot-lib/package-lock.json ../bot-lib/
COPY llama-bot/package.json llama-bot/package-lock.json ./
RUN npm ci --prefix ../bot-lib --omit=dev && npm ci --omit=dev && npm cache clean --force
COPY bot-lib/lib.js ../bot-lib/
COPY llama-bot/bot.js ./
USER node
ENV DATA_DIR=/data
CMD ["node", "bot.js"]
