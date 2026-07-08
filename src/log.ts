import pino from "pino";
import pretty from "pino-pretty";

// Run pino-pretty as an in-process sync stream instead of a worker-thread
// transport: the worker's MessagePort can stay referenced after the last log
// (thread-stream race) and intermittently keep the CLI from exiting.
export const log = pino(
  pretty({
    colorize: true,
    sync: true,
  })
);
