FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/engineering-runner/package.json apps/engineering-runner/

RUN npm install --include=dev

COPY . .

RUN npm run build --workspace apps/engineering-runner

ENV NODE_ENV=production

CMD ["npm", "run", "start", "--workspace", "apps/engineering-runner"]
