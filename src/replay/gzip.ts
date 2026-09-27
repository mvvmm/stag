/** gzip via Web Streams, which browsers and Node 24 both have, so tests run the same code. */

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const gzip = (text: string): Promise<Uint8Array> =>
  pipe(new TextEncoder().encode(text), new CompressionStream("gzip"));

/** Whether the bytes start with the gzip magic number. */
export const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Text from gzipped or plain bytes (a replay can be saved either way). */
export async function readText(bytes: Uint8Array): Promise<string> {
  const plain = isGzip(bytes) ? await pipe(bytes, new DecompressionStream("gzip")) : bytes;
  return new TextDecoder().decode(plain);
}
