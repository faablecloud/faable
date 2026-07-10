import test from "ava";
import { LogBuffer } from "./log_buffer";

test("accumulates chunks in order", (t) => {
  const buf = new LogBuffer();
  buf.append("hello ");
  buf.append(Buffer.from("world\n"));
  const { content, truncated, size } = buf.contents();
  t.is(content, "hello world\n");
  t.false(truncated);
  t.is(size, Buffer.byteLength("hello world\n"));
});

test("caps by dropping head chunks and latches truncated", (t) => {
  const buf = new LogBuffer(100);
  buf.append("FIRST-".padEnd(60, "a") + "\n");
  buf.append("SECOND".padEnd(60, "b") + "\n");
  buf.append("THIRD-".padEnd(30, "c") + "\n");
  const { content, truncated } = buf.contents();
  t.true(truncated);
  t.false(content.includes("FIRST"));
  t.true(content.includes("THIRD"));
  // Latch: even if later appends fit, truncated stays true
  buf.append("x");
  t.true(buf.contents().truncated);
});

test("never drops the only chunk even when over cap", (t) => {
  const buf = new LogBuffer(10);
  buf.append("a".repeat(50));
  const { content } = buf.contents();
  t.is(content.length, 50);
});

test("strips ANSI escape sequences on read", (t) => {
  const buf = new LogBuffer();
  buf.append("\x1B[32mgreen\x1B[0m and \x1B]8;;http://x\x07link\x1B]8;;\x07");
  const { content } = buf.contents();
  t.is(content, "green and link");
});

test("reset clears content and truncated flag", (t) => {
  const buf = new LogBuffer(10);
  buf.append("a".repeat(20));
  buf.append("b".repeat(20));
  buf.reset();
  const { content, truncated, size } = buf.contents();
  t.is(content, "");
  t.false(truncated);
  t.is(size, 0);
});
