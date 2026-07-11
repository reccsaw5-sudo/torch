# Torch backend (business server: login + brand + admin console).
# Build context = torch-server/. Runs the FastAPI app on 0.0.0.0:8080.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_HOST=0.0.0.0 \
    TORCH_PORT=8080

WORKDIR /app

# curl is only used by the container healthcheck. psycopg[binary] ships
# manylinux wheels, so no compiler toolchain is needed on slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
RUN mkdir -p /app/data

EXPOSE 8080

# app.py opens the DB pool + runs migrations at import time, so the database
# must be reachable (compose gates this via depends_on: service_healthy).
CMD ["python", "app.py"]
