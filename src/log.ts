import pino from "pino";
import pretty, { prettyFactory } from "pino-pretty";
import { buildLog } from "./lib/log_buffer";

// Run pino-pretty as in-process sync streams instead of a worker-thread
// transport: the worker's MessagePort can stay referenced after the last log
// (thread-stream race) and intermittently keep the CLI from exiting.
//
// Tee: terminal stream (colorized) + a plain-text copy into the build-log
// buffer so CLI messages land in the logs attached to the deployment.
// What the terminal shows: just the message. pino's envelope
// (`[12:03:44.101] INFO (54834):`) is noise for a CLI — a timestamp and a pid
// per line are for a log file, not for someone waiting on a deploy.
//
// Dropping the level token would also drop its color (pino-pretty tints the
// whole line cyan otherwise), so the level is carried by the MESSAGE color
// instead: warnings yellow, errors red, everything else the usual cyan.
const LEVEL_COLOR: Record<number, string> = {
  40: "\u001b[33m", // warn
  50: "\u001b[31m", // error
  60: "\u001b[31m", // fatal
};

const TERMINAL_FORMAT = {
  ignore: "pid,hostname,time,level",
  messageFormat: (log: Record<string, unknown>, key: string) => {
    const message = String(log[key] ?? "");
    const color = LEVEL_COLOR[Number(log.level)];
    return color ? `${color}${message}\u001b[39m` : message;
  },
} as const;

// The archived copy KEEPS the envelope: these lines are attached to the
// deployment and read later (support, post-mortems), where the timestamp and
// level are the whole point.
const toPlainText = prettyFactory({ colorize: false, sync: true });

// NB: the two-arg form matters — pino(multistream) alone would treat the
// multistream object as the options bag and log raw JSON to stdout.
export const log = pino(
  {},
  pino.multistream([
    { stream: pretty({ colorize: true, sync: true, ...TERMINAL_FORMAT }) },
    {
      stream: {
        write(line: string) {
          buildLog.append(toPlainText(line));
        },
      },
    },
  ])
);
