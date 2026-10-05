import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

// Avoid the shorter fetch headers timeout during long image processing.
export function ollamaFetch(url, options) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(target, { method: options.method, headers: options.headers, signal: options.signal }, res => {
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }));
    });
    req.on('error', error => reject(options.signal?.aborted ? options.signal.reason : error));
    req.end(options.body);
  });
}
