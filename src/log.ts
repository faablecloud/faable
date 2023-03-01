//import * as core from "@actions/core";
import pino from "pino";

export const log = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});
