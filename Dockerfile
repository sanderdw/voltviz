# The site is static, so build it once on the build machine's own platform instead of once per
# target platform under emulation.
FROM --platform=$BUILDPLATFORM node:26-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.31.9-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /etc/nginx/site.d
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
