FROM {{from}}
LABEL com.faable.cloud="FaableCloud"
LABEL description="Faablecloud automatic deployment"

WORKDIR /faable/app

# Environment variables for runtime
ENV PORT=80
ENV NODE_ENV=production
ENV START_SCRIPT=start

# Copy Usercode
COPY . .

CMD ["/bin/sh", "./entrypoint.sh"]  
