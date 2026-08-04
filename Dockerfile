# Forge — runs as a full Node.js app in a Cloudflare Container
# (full Linux environment = child_process/spawn works for builds)
FROM node:22-slim
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY prisma ./prisma
RUN bunx prisma generate
COPY . .
RUN bun run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["bun", ".next/standalone/server.js"]
