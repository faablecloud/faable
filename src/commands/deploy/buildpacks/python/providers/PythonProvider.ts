/**
 * A dependency provider is one manifest format the python buildpack
 * understands. Evaluated in registry order; the first whose `files` exist
 * wins and supplies the install command (before server injection and before
 * the faable.json `buildCommand` override).
 */
export interface PythonProviderResult {
  /** Base install command run inside the image build. */
  install_command?: string;
  /**
   * Manifests to COPY before the install RUN (cacheable dependency layer).
   * Omit when the install needs the full source (e.g. `pip install .`).
   */
  install_files?: string[];
  /** Python version declared by the manifest (e.g. cerebrium.toml). */
  python_version?: string;
  /** Extra text for the dependency blob used by framework detection. */
  deps_text?: string;
  /** Start command declared by the manifest (e.g. cerebrium entrypoint). */
  start_hint?: string;
}

export interface PythonProvider {
  name: string;
  /** Trigger files for this provider. */
  files: string[];
  resolve(workdir: string): PythonProviderResult;
}
