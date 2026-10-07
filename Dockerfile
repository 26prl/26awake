FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=8000 TRACKER_DB=/data/tracker.db
VOLUME /data
EXPOSE 8000
CMD ["python", "-m", "tracker"]
