import pino from "pino";
import pretty, { prettyFactory } from "pino-pretty";
import { buildLog } from "./lib/log_buffer";

// Run pino-pretty as in-process sync streams instead of a worker-thread
// transport: the worker's MessagePort can stay referenced after the last log
// (thread-stream race) and intermittently keep the CLI from exiting.
//
// Tee: terminal stream (colorized) + a plain-text copy into the build-log
// buffer so CLI messages land in the logs attached to the deployment.
const toPlainText = prettyFactory({ colorize: false, sync: true });

// NB: the two-arg form matters — pino(multistream) alone would treat the
// multistream object as the options bag and log raw JSON to stdout.
export const log = pino(
  {},
  pino.multistream([
    { stream: pretty({ colorize: true, sync: true }) },
    {
      stream: {
        write(line: string) {
          buildLog.append(toPlainText(line));
        },
      },
    },
  ])
);
