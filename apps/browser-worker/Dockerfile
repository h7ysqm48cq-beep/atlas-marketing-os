FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 4010

CMD ["npm","start"]
