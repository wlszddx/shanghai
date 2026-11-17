FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json server.js app.js index.html styles.css ./
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4173
CMD ["node", "server.js"]
