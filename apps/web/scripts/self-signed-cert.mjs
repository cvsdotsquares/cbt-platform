import { generateKeyPairSync, createSign, X509Certificate, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CERT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'certificates');
export const CERT_PATH = path.join(CERT_DIR, 'dev-cert.pem');
export const KEY_PATH = path.join(CERT_DIR, 'dev-key.pem');

function lanHosts() {
  const dns = new Set(['localhost']);
  const ips = new Set(['127.0.0.1']);
  const hostname = os.hostname();
  if (hostname) {
    dns.add(hostname);
    if (!hostname.includes('.')) dns.add(`${hostname}.local`);
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const net of addrs || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && net.address) ips.add(net.address);
    }
  }
  return { dns: [...dns], ips: [...ips] };
}

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len <= 0xff) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function tlv(tag, value) {
  const v = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([Buffer.from([tag]), encodeLength(v.length), v]);
}

function concat(parts) {
  return Buffer.concat(parts);
}

function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const bytes = [part & 0x7f];
    let n = part >> 7;
    while (n > 0) {
      bytes.push((n & 0x7f) | 0x80);
      n >>= 7;
    }
    out.push(...bytes.reverse());
  }
  return tlv(0x06, Buffer.from(out));
}

function encodeInteger(buf) {
  let bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  while (bytes.length > 1 && bytes[0] === 0x00 && bytes[1] < 0x80) {
    bytes = bytes.subarray(1);
  }
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  return tlv(0x02, bytes);
}

function encodeBitString(data, unusedBits = 0) {
  return tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), data]));
}

function utcTime(date) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const pad = (n) => String(n).padStart(2, '0');
  const s = `${yy}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return tlv(0x17, s);
}

function nameWithCN(cn) {
  const attr = tlv(0x30, concat([encodeOid('2.5.4.3'), tlv(0x0c, cn)]));
  return tlv(0x30, tlv(0x31, attr));
}

function extension(oid, value, critical = false) {
  const parts = [encodeOid(oid)];
  if (critical) parts.push(tlv(0x01, Buffer.from([0xff])));
  parts.push(tlv(0x04, value));
  return tlv(0x30, concat(parts));
}

function subjectAltName({ dns, ips }) {
  const names = [
    ...dns.map((host) => tlv(0x82, host)),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  ];
  return extension('2.5.29.17', tlv(0x30, concat(names)));
}

function pem(type, der) {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----\n`;
}

export function generateSelfSignedCert(hosts = lanHosts()) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + 825 * 24 * 60 * 60 * 1000);
  const serial = encodeInteger(cryptoRandomSerial());
  const algo = tlv(0x30, concat([encodeOid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0))]));
  const cn = nameWithCN('CBT Dev');
  const validity = tlv(0x30, concat([utcTime(notBefore), utcTime(notAfter)]));
  const version = tlv(0xa0, encodeInteger(Buffer.from([0x02])));
  const keyUsage = extension(
    '2.5.29.15',
    encodeBitString(Buffer.from([0xa0]), 5),
    true,
  );
  const extKeyUsage = extension(
    '2.5.29.37',
    tlv(0x30, encodeOid('1.3.6.1.5.5.7.3.1')),
  );
  const san = subjectAltName(hosts);
  const extensions = tlv(0xa3, tlv(0x30, concat([keyUsage, extKeyUsage, san])));
  const tbs = tlv(0x30, concat([version, serial, algo, cn, validity, cn, spki, extensions]));
  const signer = createSign('SHA256');
  signer.update(tbs);
  const signature = encodeBitString(signer.sign(privateKey));
  const certDer = tlv(0x30, concat([tbs, algo, signature]));
  return {
    cert: pem('CERTIFICATE', certDer),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    hosts,
  };
}

function cryptoRandomSerial() {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  if (bytes[0] === 0) bytes[0] = 0x11;
  return bytes;
}

function certCoversHosts(certPem, hosts) {
  try {
    const parsed = new X509Certificate(certPem);
    const san = parsed.subjectAltName || '';
    const validTo = Date.parse(parsed.validTo);
    if (!Number.isFinite(validTo) || validTo - Date.now() < 7 * 24 * 60 * 60 * 1000) return false;
    return hosts.dns.every((d) => san.includes(`DNS:${d}`))
      && hosts.ips.every((ip) => san.includes(`IP Address:${ip}`));
  } catch {
    return false;
  }
}

export function ensureDevCertificate() {
  const hosts = lanHosts();
  fs.mkdirSync(CERT_DIR, { recursive: true });
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    const existing = fs.readFileSync(CERT_PATH, 'utf8');
    if (certCoversHosts(existing, hosts)) {
      return { cert: CERT_PATH, key: KEY_PATH, hosts, reused: true };
    }
  }
  const generated = generateSelfSignedCert(hosts);
  fs.writeFileSync(CERT_PATH, generated.cert);
  fs.writeFileSync(KEY_PATH, generated.key);
  return { cert: CERT_PATH, key: KEY_PATH, hosts, reused: false };
}
