FROM {{from}}
LABEL com.faable.cloud="FaableCloud"
LABEL description="Faablecloud automatic deployment"

WORKDIR /faable/app

# Environment variables for runtime
ENV PORT=80
{{#each env}}
ENV {{@key}}={{this}}
{{/each}}
# `escape` keeps `$PORT` literal so the build heredoc (unquoted bash) doesn't
# eat it; Docker then expands $PORT (=80) when building the ENV value.
ENV START_COMMAND="{{{escape start_command}}}"

{{#if install_files}}
# Copy dependency manifests first so the install layer stays cached until
# they change (any source change no longer reinstalls dependencies).
{{#each install_files}}
COPY {{this}} ./
{{/each}}
RUN {{{escape install_command}}}
{{/if}}

# Copy Usercode
COPY . .

{{#unless install_files}}
{{#if install_command}}
# Install needs the full source (e.g. `pip install .`), so it runs after COPY.
RUN {{{escape install_command}}}
{{/if}}
{{/unless}}

# Entrypoint stript
RUN echo '{{{escape entry_script}}}' >> entrypoint.sh

CMD ["/bin/sh", "./entrypoint.sh"]
