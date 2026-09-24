FROM node:24-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/llama-bot
COPY bot-lib/package.json bot-lib/package-lock.json ../bot-lib/
COPY llama-bot/package.json llama-bot/package-lock.json ./
RUN npm ci --prefix ../bot-lib --omit=dev && npm ci --omit=dev && npm cache clean --force
COPY bot-lib/lib.js ../bot-lib/
COPY llama-bot/bot.js ./
USER node
ENV DATA_DIR=/data
CMD ["node", "bot.js"]
