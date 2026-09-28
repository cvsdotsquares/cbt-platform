import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const INTERNAL_HOST = '127.0.0.1';

function hostnameOf(hostHeader = '') {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(':')[0];
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function proxyRequest(req, res, { internalPort, proto }) {
  const host = hostnameOf(req.headers.host || '');
  if (proto === 'http' && host && !isLoopback(host)) {
    res.writeHead(307, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
    return;
  }

  const headers = { ...req.headers };
  headers['x-forwarded-proto'] = proto;
  if (req.socket.remoteAddress) headers['x-forwarded-for'] = req.socket.remoteAddress;

  const upstream = http.request(
    {
      hostname: INTERNAL_HOST,
      port: internalPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (incoming) => {
      res.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Starting the exam app… refresh in a moment.');
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, clientSocket, head, internalPort) {
  const upstream = net.connect(internalPort, INTERNAL_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on('error', close);
  clientSocket.on('error', close);
}

export function startDualProtocolProxy({ publicPort, internalPort, keyPath, certPath }) {
  const tlsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  const httpServer = http.createServer((req, res) => {
    proxyRequest(req, res, { internalPort, proto: 'http' });
  });
  const httpsServer = https.createServer(tlsOptions, (req, res) => {
    proxyRequest(req, res, { internalPort, proto: 'https' });
  });
  httpServer.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, internalPort));
  httpsServer.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, internalPort));
  httpServer.on('clientError', (_, socket) => socket.destroy());
  httpsServer.on('clientError', (_, socket) => socket.destroy());

  const gate = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      socket.pause();
      socket.unshift(chunk);
      const target = chunk[0] === 0x16 ? httpsServer : httpServer;
      target.emit('connection', socket);
      process.nextTick(() => {
        if (!socket.destroyed) socket.resume();
      });
    });
    socket.on('error', () => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    gate.once('error', reject);
    gate.listen(publicPort, '0.0.0.0', () => {
      resolve({
        close() {
          gate.close();
          httpServer.close();
          httpsServer.close();
        },
      });
    });
  });
}
