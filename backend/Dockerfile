FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data \
    HF_HOME=/app/data/huggingface
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock \
    && groupadd --gid 10001 rag \
    && useradd --uid 10001 --gid 10001 --create-home rag \
    && mkdir -p /app/data \
    && chmod 0700 /app/data \
    && chown -R rag:rag /app/data
COPY app ./app
USER 10001:10001
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log"]
