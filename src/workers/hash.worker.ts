/**
 * Web Worker for calculating local SHA-1 hashes of mod .jar files without
 * blocking the main UI thread. Uses Web Crypto API when available, with a
 * deterministic pure-JS SHA-1 fallback for restricted contexts.
 */

export interface HashWorkerRequest {
  type: 'hash';
  id: string;
  file: File;
}

export interface HashWorkerResponse {
  type: 'result' | 'error';
  id: string;
  sha1?: string;
  error?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hex[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hex.join('');
}

function fallbackSha1(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const len = data.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setInt32(0, h0, false);
  outView.setInt32(4, h1, false);
  outView.setInt32(8, h2, false);
  outView.setInt32(12, h3, false);
  outView.setInt32(16, h4, false);
  return bytesToHex(out);
}

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const { type, id, file } = event.data;
  if (type !== 'hash') return;

  try {
    const buffer = await file.arrayBuffer();
    let sha1: string;
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const digest = await crypto.subtle.digest('SHA-1', buffer);
      sha1 = bytesToHex(new Uint8Array(digest));
    } else {
      sha1 = fallbackSha1(buffer);
    }

    const response: HashWorkerResponse = {
      type: 'result',
      id,
      sha1,
    };
    self.postMessage(response);
  } catch (err) {
    const response: HashWorkerResponse = {
      type: 'error',
      id,
      error: err instanceof Error ? err.message : 'Unable to read or hash this file.',
    };
    self.postMessage(response);
  }
};
