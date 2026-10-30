FROM python:3.14-slim
WORKDIR /engine
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY dbeef ./dbeef
COPY examples ./examples
RUN python examples/make_sample.py
USER nobody
EXPOSE 8765
# 0.0.0.0 so Docker can forward the port; compose publishes it on 127.0.0.1 only.
ENTRYPOINT ["python", "-m", "dbeef", "--host", "0.0.0.0", "--port", "8765"]
CMD ["--config", "examples/dbeef.example.yaml", "--dev-token", "dev", "--allow-origin", "http://localhost:5173"]
