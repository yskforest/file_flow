FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /opt/fileflow-test
COPY test/docker/package.json test/docker/package-lock.json ./
RUN npm ci --ignore-scripts
ENV NODE_PATH=/opt/fileflow-test/node_modules
WORKDIR /app
COPY . .
RUN mkdir -p lib && cp /opt/fileflow-test/node_modules/jszip/dist/jszip.min.js lib/ && cp /opt/fileflow-test/node_modules/gridjs/dist/gridjs.umd.js lib/ && cp /opt/fileflow-test/node_modules/gridjs/dist/theme/mermaid.min.css lib/gridjs-mermaid.min.css
CMD ["sh", "test/docker/run.sh"]
