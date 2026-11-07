FROM python:3.14-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
RUN useradd --uid 10001 --create-home nova && mkdir /app/data && chown nova:nova /app/data
USER nova
ENV NOVA_DB=/app/data/nova.sqlite
EXPOSE 4190
CMD ["python", "nova.py", "serve", "--host", "0.0.0.0"]
