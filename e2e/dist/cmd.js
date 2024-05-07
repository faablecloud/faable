"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmd = void 0;
const promisify_child_process_1 = require("promisify-child-process");
const cmd = async (cmd, config) => {
    // Defaults
    const enableOutput = config?.enableOutput || false;
    const timeout = config?.timeout;
    const cwd = config?.cwd;
    const child = (0, promisify_child_process_1.spawn)("/bin/bash", ["-c", cmd], {
        encoding: "utf8",
        stdio: enableOutput ? "inherit" : "pipe",
        timeout,
        cwd,
    });
    const out_data = [];
    child.stderr?.on("data", (data) => {
        out_data.push(data);
    });
    child.stdout?.on("data", (data) => {
        out_data.push(data);
    });
    try {
        const result = await child;
        return result;
    }
    catch (error) {
        const output = out_data.map((b) => b.toString()).join("\n");
        // console.log(output);
        throw new Error(`Command error: ${cmd}`);
    }
};
exports.cmd = cmd;
