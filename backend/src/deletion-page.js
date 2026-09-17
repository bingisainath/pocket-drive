// A public page explaining how to delete a Pocket Drive account and what is kept. Linked from the
// Google Play Console "data deletion" field. Self-contained HTML (no frontend build needed).

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function accountDeletionPageHtml({ ownerEmail } = {}) {
  const contact = ownerEmail
    ? `<p>Questions, or can’t sign in? Email the drive owner at <a href="mailto:${escape(ownerEmail)}">${escape(ownerEmail)}</a>.</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Delete your Pocket Drive account</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f8fafc; color: #0f172a; font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  .muted { color: #64748b; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #020617; color: #f1f5f9; }
    .muted { color: #94a3b8; }
    .card { background: #0f172a; border-color: #1e293b; }
    a { color: #3b82f6; }
  }
</style>
</head>
<body>
<main>
  <h1>Delete your Pocket Drive account</h1>
  <p class="muted">Pocket Drive is a private, self-hosted drive. Only people invited by the drive owner have an account.</p>

  <h2>How to delete your account</h2>
  <div class="card">
    <ul>
      <li>Open the <strong>Pocket Drive</strong> app and sign in.</li>
      <li>Go to <strong>Settings → Delete account</strong> and confirm.</li>
    </ul>
    <p class="muted">Your account is removed immediately and you are signed out on every device.</p>
  </div>

  <h2>What is deleted</h2>
  <ul>
    <li>Your account and profile (name, email, photo from Google sign-in).</li>
    <li>Your access to every folder shared with you.</li>
    <li>All of your sign-ins (sessions) and any devices registered for notifications.</li>
  </ul>

  <h2>What is kept</h2>
  <ul>
    <li>Files you uploaded remain on the owner’s drive — they belong to the drive owner, not to your account.</li>
  </ul>
  <p class="muted">If you want specific files removed as well, ask the drive owner before deleting your account.</p>

  ${contact}
</main>
</body>
</html>`;
}
