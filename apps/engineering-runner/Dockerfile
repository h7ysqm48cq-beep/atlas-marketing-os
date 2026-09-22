FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        openssh-client \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/engineering-runner/package.json apps/engineering-runner/

RUN npm install --include=dev

COPY . .

RUN npm run build --workspace apps/engineering-runner

# Railway Git metadata is provided to GitHub-triggered builds as Docker ARGs.
# Verify the exact commit and image source blob identities while build logs
# still expose rejection codes. The pre-deploy Gate verifies only this receipt.
ARG RAILWAY_GIT_REPO_OWNER
ARG RAILWAY_GIT_REPO_NAME
ARG RAILWAY_GIT_BRANCH
ARG RAILWAY_GIT_COMMIT_SHA
RUN node --test apps/engineering-runner/check-runner-bootstrap-deployment.spec.cjs
RUN node apps/engineering-runner/check-runner-bootstrap-deployment.cjs --build-verify

ENV NODE_ENV=production

CMD ["npm", "run", "start", "--workspace", "apps/engineering-runner"]
