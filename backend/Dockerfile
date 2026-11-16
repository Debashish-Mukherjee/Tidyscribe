FROM python:3.12-slim AS runtime

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# Optional corporate roots; the default context contains only a README.
COPY --from=certs . /tmp/custom-certs/
RUN for cert in /tmp/custom-certs/*.crt /tmp/custom-certs/*.pem /tmp/custom-certs/*.cer; do \
      [ ! -f "$cert" ] || cat "$cert" >> /etc/ssl/certs/ca-certificates.crt; \
    done
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends fonts-dejavu-core fonts-dejavu-extra fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt constraints.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip==26.3 \
    && pip install --no-cache-dir -r requirements.txt

# Optional higher-fidelity export tools (about 1 GB): docker compose build --build-arg INSTALL_DOC_TOOLS=true worker
ARG INSTALL_DOC_TOOLS=false
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN if [ "$INSTALL_DOC_TOOLS" = "true" ]; then \
      apt-get update -qq \
      && apt-get install -y -qq --no-install-recommends pandoc libreoffice-writer fonts-liberation chromium nodejs npm \
      && npm config set cafile /etc/ssl/certs/ca-certificates.crt \
      && PUPPETEER_SKIP_DOWNLOAD=true npm install -g --no-audit --no-fund @mermaid-js/mermaid-cli@11.4.2 \
      && rm -rf /var/lib/apt/lists/* /root/.npm; \
    fi

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM runtime AS test
COPY requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY tests ./tests
COPY bench ./bench
COPY scripts ./scripts

# Keep test frameworks and PDF inspection tools out of the default image.
FROM runtime AS production
