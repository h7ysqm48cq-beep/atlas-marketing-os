FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        chromium \
        xvfb \
        x11-utils \
        x11vnc \
        fluxbox \
        novnc \
        websockify \
        ca-certificates \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        procps \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV DISPLAY=:99
ENV BROWSER_WORKER_PORT=4010
ENV NOVNC_PORT=6080
ENV SCREEN_WIDTH=1365
ENV SCREEN_HEIGHT=768
ENV SCREEN_DEPTH=24

COPY package.json package-lock.json ./
COPY apps/browser-worker/package.json apps/browser-worker/

RUN npm install

COPY . .

RUN npm run build --workspace apps/browser-worker

RUN chmod +x /app/apps/browser-worker/docker-entrypoint.sh

EXPOSE 4010
EXPOSE 6080

ENTRYPOINT ["/app/apps/browser-worker/docker-entrypoint.sh"]
