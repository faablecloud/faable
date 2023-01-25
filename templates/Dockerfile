FROM {{from}}
LABEL com.faable.cloud="FaableCloud"
LABEL description="Faablecloud automatic deployment"

WORKDIR /faable/app

# Environment variables for runtime
ENV PORT=80
ENV NODE_ENV=production

# Copy Usercode
COPY ./ /faable/app

RUN echo '{{{escape entry_script}}}' >> entrypoint.sh

# Build the project if requested
{{#if build_script}}
RUN echo "Running build command: {{build_script}}"
RUN yarn run {{build_script}}
{{/if}}


CMD ["/bin/sh", "/faable/app/entrypoint.sh","{{start_script}}"]  
