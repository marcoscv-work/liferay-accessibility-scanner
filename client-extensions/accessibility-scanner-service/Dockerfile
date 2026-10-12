FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npx esbuild --version >/dev/null 2>&1 || npm install esbuild
COPY . .
RUN npm run build

ENV PORT=58082
EXPOSE 58082
CMD ["node", "src/server.js"]
