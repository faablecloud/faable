import fs from "fs-extra";

/**
 * Decode a manifest/source buffer to a string, honoring a leading BOM.
 *
 * Editors and shells on Windows (PowerShell `>` redirection, Notepad "Save As")
 * frequently write files as UTF‑16 with a BOM. Reading those as UTF‑8 yields
 * mojibake with interleaved NUL bytes (`f\x00a\x00s\x00t…`), which silently
 * breaks token detection — e.g. `\bfastapi\b` never matches a UTF‑16
 * `requirements.txt`, so the Python buildpack skips framework detection and
 * fails with "Could not detect how to start this Python app". Detect the BOM and
 * decode accordingly, stripping the BOM from the result.
 */
export const decode_buffer = (buf: Buffer): string => {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf.subarray(2));
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  return buf.toString("utf8");
};

/** Read a file to a string, decoding UTF‑16/UTF‑8 BOMs (see {@link decode_buffer}). */
export const read_text_file = (file: string): string =>
  decode_buffer(fs.readFileSync(file));

/** Read and parse a JSON file, tolerating a UTF‑16/UTF‑8 BOM. */
export const read_json_file = <T = unknown>(file: string): T =>
  JSON.parse(read_text_file(file)) as T;
