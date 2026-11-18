FROM node:22-alpine

ARG GIT_COMMIT=dev
ARG BUILD_TIME=

RUN apk add --no-cache ffmpeg

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json server.js app.js index.html styles.css ./
RUN printf '%s %s\n' "$GIT_COMMIT" "$BUILD_TIME" > /app/VERSION && chown node:node /app/VERSION && mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4173
CMD ["node", "server.js"]
