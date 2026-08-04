FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./

COPY apps/browser-worker/package.json apps/browser-worker/

RUN npm install

COPY . .

RUN npm run build --workspace apps/browser-worker

EXPOSE 4010

CMD ["npm","run","start","--workspace","apps/browser-worker"]
