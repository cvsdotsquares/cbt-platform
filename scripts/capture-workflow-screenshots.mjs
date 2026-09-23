/**
 * Captures role-based workflow screenshots for docs/USER-WORKFLOW-GUIDE.md
 * Usage: node scripts/capture-workflow-screenshots.mjs
 * Requires: web on http://localhost:3002, API on http://localhost:8000
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'workflow-screenshots');
const BASE = 'http://localhost:3002';

const USERS = {
  admin: { email: 'admin@cbt-platform.com', password: 'Admin@123' },
  teacher: { email: 'teacher@example.com', password: 'Teacher@123' },
  candidate: { email: 'candidate@example.com', password: 'Candidate@123' },
};

async function login(page, creds) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', creds.email);
  await page.fill('#password', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function shot(page, fileName) {
  const filePath = path.join(OUT, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log('Saved', fileName);
}

async function logout(page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'super-admin'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'teacher'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'candidate'), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const adminRoutes = [
    ['01-home-dashboard.png', '/dashboard'],
    ['02-ncert-books.png', '/dashboard/materials'],
    ['03-classes-batches.png', '/dashboard/batches'],
    ['04-syllabus.png', '/dashboard/syllabus'],
    ['05-create-class-test.png', '/dashboard/ai-tests'],
    ['06-class-tests.png', '/dashboard/exams'],
    ['07-students.png', '/dashboard/candidates'],
    ['08-results.png', '/dashboard/results'],
    ['09-staff-teachers.png', '/dashboard/users'],
    ['10-institute-settings.png', '/dashboard/settings'],
    ['11-institutes.png', '/dashboard/institutes'],
    ['12-school-setup.png', '/dashboard/setup'],
    ['13-live-monitoring.png', '/dashboard/monitoring'],
    ['14-help-guide.png', '/dashboard/guide'],
  ];

  {
    const page = await context.newPage();
    await login(page, USERS.admin);
    for (const [name, route] of adminRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      await shot(page, path.join('super-admin', name));
    }
    await page.close();
  }

  const teacherRoutes = [
    ['01-home-dashboard.png', '/dashboard/teacher'],
    ['02-syllabus.png', '/dashboard/syllabus'],
    ['03-topic-progress.png', '/dashboard/batches'],
    ['04-create-class-test.png', '/dashboard/ai-tests'],
    ['05-class-tests.png', '/dashboard/exams'],
    ['06-my-students.png', '/dashboard/candidates'],
    ['07-results.png', '/dashboard/results'],
    ['08-help-guide.png', '/dashboard/guide'],
  ];

  {
    const page = await context.newPage();
    await login(page, USERS.teacher);
    for (const [name, route] of teacherRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      await shot(page, path.join('teacher', name));
    }
    await page.close();
  }

  {
    const page = await context.newPage();
    await login(page, USERS.candidate);
    await page.goto(`${BASE}/my-exams`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await shot(page, path.join('candidate', '01-portal-class-tests.png'));

    await page.getByRole('button', { name: /Results/i }).click();
    await page.waitForTimeout(1000);
    await shot(page, path.join('candidate', '02-portal-results.png'));

    await page.getByRole('button', { name: /Test syllabus/i }).click();
    await page.waitForTimeout(1000);
    await shot(page, path.join('candidate', '03-portal-test-syllabus.png'));

    await page.close();
  }

  await browser.close();
  console.log('Done. Output:', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
