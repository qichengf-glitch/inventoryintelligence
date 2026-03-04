FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY server/preprocessing/requirements.txt ./server/preprocessing/requirements.txt

RUN npm --prefix frontend ci \
  && pip3 install --no-cache-dir -r server/preprocessing/requirements.txt

COPY . .

RUN npm --prefix frontend run build

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

EXPOSE 8080

CMD ["npm", "run", "start"]
