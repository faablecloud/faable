// In-memory capture of everything the deploy prints (subprocess output via
// cmd(), CLI messages via the pino tee in log.ts) so it can be attached to
// the deployment at the end. Keep-tail: when the cap is hit, head chunks are
// dropped — a failing build's useful signal is at the end of the output.

// Keep in lockstep with DEPLOYMENT_LOG_MAX_BYTES on the API side.
export const LOG_CAP_BYTES = 2 * 1024 * 1024;

// CSI (colors, cursor) + OSC (titles, hyperlinks) escape sequences.
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

export class LogBuffer {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private dropped = false;

  constructor(private cap: number = LOG_CAP_BYTES) {}

  append(chunk: string | Buffer): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.bytes += buf.length;
    while (this.bytes > this.cap && this.chunks.length > 1) {
      const head = this.chunks.shift()!;
      this.bytes -= head.length;
      this.dropped = true;
    }
  }

  contents(): { content: string; truncated: boolean; size: number } {
    const content = Buffer.concat(this.chunks)
      .toString("utf8")
      .replace(ANSI_RE, "");
    return {
      content,
      truncated: this.dropped,
      size: Buffer.byteLength(content, "utf8"),
    };
  }

  reset(): void {
    this.chunks = [];
    this.bytes = 0;
    this.dropped = false;
  }
}

// Process-wide buffer for the current deploy session.
export const buildLog = new LogBuffer();
