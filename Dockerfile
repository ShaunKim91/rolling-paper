FROM cloudflare/cloudflared:latest AS tunnel

FROM node:22-alpine
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
WORKDIR /app
COPY server.js ./
COPY public ./public
COPY start-service.sh /usr/local/bin/start-service
RUN chmod +x /usr/local/bin/start-service && apk add --no-cache git
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/start-service"]
