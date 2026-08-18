FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Keep pip/setuptools current — base image versions have known advisories (pip-audit)
RUN pip install --no-cache-dir --upgrade pip setuptools
# CPU-only torch wheel first (much smaller than the default CUDA-bundled build).
# Version range matches requirements.txt so this step and the one below agree.
RUN pip install --no-cache-dir "torch>=2.9.1,<2.14.0" --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p saved_models

EXPOSE 8000

CMD ["python", "run.py"]
