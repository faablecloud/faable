import test from "ava";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { decode_buffer, read_json_file, read_text_file } from "./read_text_file";

const utf16le_bom = (s: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

const utf16be_bom = (s: string): Buffer => {
  const le = Buffer.from(s, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
};

const utf8_bom = (s: string): Buffer =>
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, "utf8")]);

test("decode_buffer: plain UTF-8 passes through", (t) => {
  t.is(decode_buffer(Buffer.from("fastapi==1.0\n", "utf8")), "fastapi==1.0\n");
});

test("decode_buffer: UTF-8 BOM is stripped", (t) => {
  t.is(decode_buffer(utf8_bom("fastapi==1.0")), "fastapi==1.0");
});

test("decode_buffer: UTF-16 LE (PowerShell default) decodes and strips BOM", (t) => {
  const s = decode_buffer(utf16le_bom("fastapi==0.139.0\r\nuvicorn==0.51.0"));
  t.regex(s, /\bfastapi\b/);
  t.regex(s, /\buvicorn\b/);
  t.false(s.includes("﻿"));
});

test("decode_buffer: UTF-16 BE decodes and strips BOM", (t) => {
  const s = decode_buffer(utf16be_bom("fastapi==0.139.0"));
  t.regex(s, /\bfastapi\b/);
});

test("read_text_file / read_json_file: UTF-16 package.json parses", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faable-enc-"));
  const file = join(dir, "package.json");
  writeFileSync(file, utf16le_bom(JSON.stringify({ name: "x", engines: { node: "20" } })));
  t.is(read_text_file(file).includes("﻿"), false);
  const pkg = read_json_file<{ name: string; engines: { node: string } }>(file);
  t.is(pkg.name, "x");
  t.is(pkg.engines.node, "20");
});
