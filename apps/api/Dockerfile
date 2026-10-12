FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir . python-dotenv
ENV PYTHONUNBUFFERED=1 STOCKDEPTH_WEB_HOST=0.0.0.0
EXPOSE 8008
CMD ["python", "-m", "stockdepth.api.server"]
