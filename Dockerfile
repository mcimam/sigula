FROM node:24-alpine AS development-dependencies-env
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json /app/
WORKDIR /app
RUN npm ci
COPY . /app

FROM node:24-alpine AS production-dependencies-env
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
# Server modules may evaluate during build; real secret is injected at runtime.
ENV SESSION_SECRET=build-time-placeholder
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache libstdc++ wget
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/build ./build
COPY --from=build-env /app/public ./public
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["npm", "run", "start"]
