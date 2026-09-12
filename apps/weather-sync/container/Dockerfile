FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FASTF1_CACHE=/tmp/fastf1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --requirement requirements.txt
COPY app.py .

RUN install -d -m 0700 -o nobody -g nogroup /tmp/fastf1
USER nobody
EXPOSE 8080
CMD ["python", "app.py"]
