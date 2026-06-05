# ai-webbuilder — container for Cloud Run.
# The app is an always-on Express process (process-local concurrency limiter,
# in-memory prompt cache, 15-min growth scheduler), so it runs as a container
# with min-instances>=1, NOT serverless functions.

# ---- build stage: full deps + vite/esbuild build ----
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Copy the full node_modules: script/build.ts bundles an allowlist into
# dist/index.cjs but externalizes the rest, so externalized deps must exist at
# runtime. (Copying all of node_modules also covers the dev/prod `vite` import
# edge in server/vite.ts.) Image size is optimized post-cutover if needed.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Cloud Run injects PORT (8080); server reads process.env.PORT and binds 0.0.0.0.
EXPOSE 8080
CMD ["node", "dist/index.cjs"]
