import { spawn, execSync } from 'node:child_process';
import { ensureDevCertificate } from './self-signed-cert.mjs';
import { startDualProtocolProxy } from './dual-protocol-proxy.mjs';

const PORT = 3002;
const INTERNAL_PORT = 3001;
const USE_HTTPS = process.env.CBT_DEV_HTTPS !== '0';

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`,
        { stdio: 'ignore' },
      );
    } else {
      execSync(`npx --yes kill-port ${port}`, { stdio: 'ignore' });
    }
  } catch {
    // No process on port — ok
  }
}

function printUrls(hosts, { httpsEnabled }) {
  console.log('');
  console.log(`  Local:   http://localhost:${PORT}`);
  if (httpsEnabled) {
    for (const ip of hosts.ips.filter((ip) => ip !== '127.0.0.1')) {
      console.log(`  Network: https://${ip}:${PORT}`);
    }
    console.log('');
    console.log('  This computer: use http://localhost:3002 (no certificate warning).');
    console.log('  Other devices: use https:// and click Advanced → Continue once.');
  } else {
    for (const ip of hosts.ips.filter((ip) => ip !== '127.0.0.1')) {
      console.log(`  Network: http://${ip}:${PORT}`);
    }
  }
  console.log('');
}

console.log(`Preparing ports ${PORT} and ${INTERNAL_PORT}...`);
freePort(PORT);
freePort(INTERNAL_PORT);
await new Promise((resolve) => setTimeout(resolve, 300));

let hosts = { dns: ['localhost'], ips: ['127.0.0.1'] };
let proxy = null;

if (USE_HTTPS) {
  try {
    const cert = ensureDevCertificate();
    hosts = cert.hosts;
    proxy = await startDualProtocolProxy({
      publicPort: PORT,
      internalPort: INTERNAL_PORT,
      keyPath: cert.key,
      certPath: cert.cert,
    });
    console.log(cert.reused ? 'Using existing LAN HTTPS certificate.' : 'Generated LAN HTTPS certificate.');
    printUrls(hosts, { httpsEnabled: true });
  } catch (err) {
    console.warn('Could not start HTTPS on the LAN; serving HTTP only so localhost still works.');
    console.warn(err instanceof Error ? err.message : err);
    proxy = null;
    printUrls(hosts, { httpsEnabled: false });
  }
} else {
  printUrls(hosts, { httpsEnabled: false });
}

const nextPort = proxy ? INTERNAL_PORT : PORT;
const nextHost = proxy ? '127.0.0.1' : '0.0.0.0';
const child = spawn('next', ['dev', '--hostname', nextHost, '--port', String(nextPort)], {
  stdio: 'inherit',
  shell: true,
});

const shutdown = (code = 0) => {
  proxy?.close();
  process.exit(code);
};

child.on('exit', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
