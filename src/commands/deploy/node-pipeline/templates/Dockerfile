FROM {{from}}
LABEL com.faable.cloud="FaableCloud"
LABEL description="Faablecloud automatic deployment"

WORKDIR /faable/app

# Environment variables for runtime
ENV PORT=80
ENV NODE_ENV=production
ENV START_COMMAND="{{start_command}}"

# Copy Usercode
COPY . .

# Entrypoint stript
RUN echo '{{{escape entry_script}}}' >> entrypoint.sh

CMD ["/bin/sh", "./entrypoint.sh"]  
