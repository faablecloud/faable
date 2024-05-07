"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = __importDefault(require("ava"));
const cmd_1 = require("./cmd");
const build = (dir) => {
    return (0, cmd_1.cmd)(`node ../pkg/bin/faable.js -w ${dir} deploy --onlybuild kirbic-web`, {
        enableOutput: true,
    });
};
ava_1.default.serial("node", async (t) => {
    await build("../examples/node-express");
    return t.pass();
});
ava_1.default.serial("next", async (t) => {
    await build("../examples/nextjs");
    return t.pass();
});
ava_1.default.serial("docker", async (t) => {
    await build("../examples/docker-node");
    return t.pass();
});
ava_1.default.serial("python", async (t) => {
    await build("../examples/python-fastapi");
    return t.pass();
});
