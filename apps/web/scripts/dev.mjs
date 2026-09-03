import { spawn, execSync } from 'node:child_process';

const PORT = 3002;

function freePortWindows(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`,
      { stdio: 'ignore' },
    );
  } catch {
    // No process on port — ok
  }
}

function freePortUnix(port) {
  try {
    execSync(`npx --yes kill-port ${port}`, { stdio: 'ignore' });
  } catch {
    // No process on port — ok
  }
}

console.log(`Preparing port ${PORT}...`);
if (process.platform === 'win32') {
  freePortWindows(PORT);
} else {
  freePortUnix(PORT);
}

// Give the OS a moment to release the socket.
await new Promise((resolve) => setTimeout(resolve, 300));

const child = spawn('next', ['dev', '--port', String(PORT)], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
