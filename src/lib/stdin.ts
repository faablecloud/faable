// All of stdin, read asynchronously.
//
// Never `readFileSync(0)`: when stdin is a pipe from another process that has
// not written yet (`faable auth webhooks create --json | … | faable deploy
// secrets set -f -`), the descriptor is non-blocking and the synchronous read
// throws EAGAIN instead of waiting.
export const read_stdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}
