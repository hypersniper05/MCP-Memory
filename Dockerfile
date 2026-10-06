FROM python:3.11-slim

LABEL org.opencontainers.image.title="memory-mcp" \
      org.opencontainers.image.description="Memory MCP server (Streamable HTTP, stateless JSON, SQLite FTS5)" \
      org.opencontainers.image.version="1.0.0"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MEMORY_HOST=0.0.0.0 \
    MEMORY_PORT=8960 \
    MEMORY_DB=/data/memory.db \
    MEMORY_EXPORT=/data/memory.md

RUN groupadd --gid 10001 memory \
 && useradd --uid 10001 --gid memory --home-dir /app --no-create-home --shell /usr/sbin/nologin memory \
 && mkdir -p /app /data \
 && chown memory:memory /data

WORKDIR /app
COPY memory_server.py ./

# Fail the build if this image's SQLite lacks FTS5 (porter unicode61 + trigram) or generated columns.
RUN python memory_server.py --check

USER memory
EXPOSE 8960
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os,sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('MEMORY_PORT','8960'), timeout=4); sys.exit(0 if r.status == 200 else 1)"]

CMD ["python", "memory_server.py"]
