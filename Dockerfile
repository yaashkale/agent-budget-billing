FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY gateway/package.json gateway/package.json
COPY agent/package.json agent/package.json
COPY dashboard/package.json dashboard/package.json
COPY program/package.json program/package.json

RUN npm ci

COPY agent agent
COPY gateway gateway
COPY db db

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["npm", "run", "start", "--workspace", "gateway"]
