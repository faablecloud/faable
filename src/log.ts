import pino from "pino";
import pretty from "pino-pretty";

export const log = pino(
  pretty({
    colorize: true,
    messageFormat: "{timestamp}{if runtime}⚙️:{runtime} - {end}{msg}",
    ignore: "runtime",
    singleLine: true,
  })
);
