FROM {{from}}
LABEL com.faable.cloud="FaableCloud"
LABEL description="Faablecloud automatic deployment"

WORKDIR /faable/app

# Environment variables for runtime
ENV PORT=80
ENV PYTHONUNBUFFERED=1
# `escape` keeps `$PORT` literal so the build heredoc (unquoted bash) doesn't
# eat it; Docker then expands $PORT (=80) when building the ENV value.
ENV START_COMMAND="{{{escape start_command}}}"

# Copy Usercode
COPY . .

# Install dependencies (Python needs them built into the image, unlike node_modules).
# Triple-stache + escape: keep `&&` intact and any `$` heredoc-safe.
RUN {{{escape install_command}}}

# Entrypoint stript
RUN echo '{{{escape entry_script}}}' >> entrypoint.sh

CMD ["/bin/sh", "./entrypoint.sh"]
