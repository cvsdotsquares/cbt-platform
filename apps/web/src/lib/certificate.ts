import { formatRankLabel } from './rank';

export type CertificateData = {
  certificateId: string;
  certificateNumber: string;
  candidateName: string;
  candidateEmail: string;
  examTitle: string;
  examCode: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  rank: number | null;
  percentile: number | null;
  totalCandidates?: number | null;
  passingScore?: number;
  issuedAt: string | Date | null;
  verificationUrl: string;
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateCertificateHtml(cert: CertificateData, origin?: string): string {
  const issued = formatDate(cert.issuedAt);
  const verifyUrl = cert.verificationUrl.startsWith('http')
    ? cert.verificationUrl
    : `${origin || ''}${cert.verificationUrl}`;
  const passed = cert.percentage >= (cert.passingScore ?? 40);
  const rankLine = cert.rank != null
    ? `<p class="meta">${escapeHtml(formatRankLabel(cert.rank, cert.totalCandidates) ?? '')}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Certificate — ${escapeHtml(cert.certificateNumber)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      background: #f1f5f9;
      color: #0f172a;
      padding: 32px 16px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 900px;
      margin: 0 auto;
      background: #fff;
      border: 3px solid #1e3a8a;
      outline: 8px solid #f8fafc;
      outline-offset: -14px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.15);
    }
    .inner {
      margin: 20px;
      border: 2px solid #c7d2fe;
      padding: 48px 40px;
      text-align: center;
      position: relative;
      min-height: 620px;
    }
    .inner::before, .inner::after {
      content: "";
      position: absolute;
      width: 64px;
      height: 64px;
      border: 3px solid #6366f1;
      opacity: 0.35;
    }
    .inner::before { top: 16px; left: 16px; border-right: none; border-bottom: none; }
    .inner::after { bottom: 16px; right: 16px; border-left: none; border-top: none; }
    .badge {
      display: inline-block;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff;
      font-family: system-ui, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      padding: 8px 20px;
      border-radius: 999px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 42px;
      font-weight: 700;
      color: #1e1b4b;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .subtitle {
      font-family: system-ui, sans-serif;
      font-size: 14px;
      color: #64748b;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      margin-bottom: 36px;
    }
    .body-text {
      font-size: 18px;
      line-height: 1.7;
      color: #334155;
      max-width: 620px;
      margin: 0 auto 28px;
    }
    .name {
      font-size: 32px;
      font-weight: 700;
      color: #312e81;
      margin: 8px 0 20px;
      border-bottom: 2px solid #e0e7ff;
      display: inline-block;
      padding-bottom: 8px;
      min-width: 280px;
    }
    .exam {
      font-size: 22px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 6px;
    }
    .exam-code {
      font-family: system-ui, sans-serif;
      font-size: 13px;
      color: #64748b;
      margin-bottom: 32px;
    }
    .score-box {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      background: linear-gradient(135deg, #eef2ff, #f5f3ff);
      border: 1px solid #c7d2fe;
      border-radius: 16px;
      padding: 16px 32px;
      margin-bottom: 12px;
    }
    .score {
      font-size: 48px;
      font-weight: 700;
      color: #4f46e5;
      line-height: 1;
    }
    .score-max {
      font-size: 20px;
      color: #64748b;
    }
    .percentage {
      font-family: system-ui, sans-serif;
      font-size: 16px;
      font-weight: 600;
      color: ${passed ? '#059669' : '#dc2626'};
      margin-bottom: 8px;
    }
    .meta {
      font-family: system-ui, sans-serif;
      font-size: 13px;
      color: #64748b;
      margin-bottom: 36px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
      text-align: left;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      color: #64748b;
    }
    .sig-line {
      width: 180px;
      border-top: 1px solid #94a3b8;
      padding-top: 8px;
      margin-top: 40px;
      font-size: 11px;
      color: #475569;
    }
    .cert-id {
      font-family: ui-monospace, monospace;
      font-size: 11px;
      color: #6366f1;
      word-break: break-all;
    }
    .seal {
      width: 88px;
      height: 88px;
      border-radius: 50%;
      border: 3px solid #6366f1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
      font-size: 10px;
      font-weight: 800;
      color: #4f46e5;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      line-height: 1.2;
      text-align: center;
      background: radial-gradient(circle, #eef2ff 0%, #fff 70%);
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page { box-shadow: none; max-width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="inner">
      <div class="badge">Certificate of Achievement</div>
      <h1>Certificate</h1>
      <p class="subtitle">This is to certify that</p>
      <p class="name">${escapeHtml(cert.candidateName)}</p>
      <p class="body-text">has successfully completed the examination</p>
      <p class="exam">${escapeHtml(cert.examTitle)}</p>
      <p class="exam-code">${escapeHtml(cert.examCode)}</p>
      <div class="score-box">
        <span class="score">${cert.totalScore}</span>
        <span class="score-max">/ ${cert.maxScore}</span>
      </div>
      <p class="percentage">${cert.percentage.toFixed(1)}% — ${passed ? 'Passed' : 'Completed'}</p>
      ${rankLine}
      <p class="meta">Issued on <strong>${issued}</strong></p>
      <div class="footer">
        <div>
          <div class="sig-line">Authorized Signatory</div>
          <p class="cert-id" style="margin-top:16px">Cert. No: ${escapeHtml(cert.certificateNumber)}</p>
          ${verifyUrl ? `<p style="margin-top:6px;font-size:10px">Verify: ${escapeHtml(verifyUrl)}</p>` : ''}
        </div>
        <div class="seal">CBT<br/>Platform</div>
      </div>
    </div>
  </div>
  <p class="no-print" style="text-align:center;margin-top:24px;font-family:system-ui,sans-serif;font-size:13px;color:#64748b">
    Use <strong>Ctrl+P</strong> (or <strong>⌘+P</strong>) → Save as PDF to download as PDF.
  </p>
</body>
</html>`;
}

export function downloadCertificateHtml(cert: CertificateData): void {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const html = generateCertificateHtml(cert, origin);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `certificate-${cert.examCode}-${cert.certificateNumber.replace(/[^a-zA-Z0-9-]/g, '')}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function printCertificate(cert: CertificateData): void {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const html = generateCertificateHtml(cert, origin);
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=960,height=800');
  if (!printWindow) {
    downloadCertificateHtml(cert);
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
}
