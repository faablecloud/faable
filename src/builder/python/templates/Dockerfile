FROM python:3.9-slim

RUN apt-get update && apt-get install -y locales locales-all && rm -rf /var/lib/apt/lists/*

RUN sed -i '/es_ES.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen

ENV LANG es_ES.UTF-8
ENV LANGUAGE es_ES:es
ENV LC_ALL es_ES.UTF-8    

ENV PORT=80
ENV START_COMMAND="{{start_command}}"

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Entrypoint stript
RUN echo '{{{escape entry_script}}}' >> entrypoint.sh

CMD ["/bin/sh", "./entrypoint.sh"]  
