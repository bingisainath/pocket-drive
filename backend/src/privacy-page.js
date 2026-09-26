// The privacy policy, served at /privacy. Google Play requires a public URL for this, and the app's
// own settings link here. Self-contained HTML (no frontend build), same shape as deletion-page.js.
//
// Everything here is meant to describe what the code actually does. If you change what is stored,
// which third parties are involved, or the retention defaults, change this too.

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function privacyPolicyPageHtml({ ownerEmail, activityRetentionDays = 180 } = {}) {
  const contact = ownerEmail
    ? `<p>Questions about your data? Email the drive owner at <a href="mailto:${escape(ownerEmail)}">${escape(ownerEmail)}</a>.</p>`
    : '<p>Questions about your data? Contact the owner of the drive you were invited to.</p>';
  const retention = Number(activityRetentionDays) > 0
    ? `kept for ${escape(activityRetentionDays)} days, then deleted automatically`
    : 'kept until the owner removes it';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pocket Drive — Privacy Policy</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f8fafc; color: #0f172a; font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  .muted { color: #64748b; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-weight: 600; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #020617; color: #f1f5f9; }
    .muted { color: #94a3b8; }
    .card { background: #0f172a; border-color: #1e293b; }
    th, td { border-bottom-color: #1e293b; }
    a { color: #3b82f6; }
  }
</style>
</head>
<body>
<main>
  <h1>Pocket Drive — Privacy Policy</h1>
  <p class="muted">Last updated: 26 September 2026</p>

  <p>Pocket Drive is a <strong>private, self-hosted drive</strong>. There is no company behind it and no
  shared service: the app talks only to one person's own server, and only people that owner invites have
  an account. Your files are not stored on anyone else's cloud.</p>

  <h2>What the app collects, and why</h2>
  <table>
    <tr><th>Data</th><th>Why</th></tr>
    <tr><td>Your name, email address and profile picture</td><td>From Google sign-in, to identify your account and show who shared what</td></tr>
    <tr><td>Files you upload, and their names, sizes and dates</td><td>They are the point of the app. Thumbnails and preview versions are generated from them</td></tr>
    <tr><td>Photos and videos from your device</td><td><strong>Only if you turn camera backup on.</strong> Only media added after you enable it is uploaded</td></tr>
    <tr><td>A notification token for your device</td><td>To deliver push notifications about sharing and new files</td></tr>
    <tr><td>An activity log: what was uploaded, shared or deleted, when, and the IP address it came from</td><td>So the drive owner can see what happened on their own drive. ${retention}</td></tr>
  </table>

  <h2>What it is never used for</h2>
  <div class="card">
    <ul>
      <li>No advertising, and no advertising identifiers.</li>
      <li>No analytics or tracking SDKs.</li>
      <li>Your data is never sold, rented, or shared for anyone else's marketing.</li>
      <li>Nobody builds a profile of you. Your files are not scanned, indexed or read for any purpose
          other than serving them back to you and the people the owner shared them with.</li>
    </ul>
  </div>

  <h2>Who else is involved</h2>
  <p>The app uses three outside services, and nothing else:</p>
  <ul>
    <li><strong>Google Sign-In</strong> — verifies who you are. Google tells the drive your email, name
        and profile picture. <a href="https://policies.google.com/privacy">Google's privacy policy</a>.</li>
    <li><strong>Firebase Cloud Messaging</strong> — carries push notifications to your device. Notification
        text may pass through Google's servers on the way.</li>
    <li><strong>Cloudflare</strong> — traffic between your device and the drive travels through Cloudflare's
        network, which sees connection metadata such as IP addresses.
        <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</li>
  </ul>

  <h2>What stays on your phone</h2>
  <ul>
    <li><strong>App lock.</strong> If you enable the fingerprint, face or PIN lock, that check happens
        entirely on your device. No biometric data is read by the app or sent anywhere — Android only
        tells the app whether the check passed.</li>
    <li><strong>Your sign-in token</strong>, stored in Android's encrypted keystore.</li>
    <li><strong>Files waiting to upload</strong>, until they finish.</li>
  </ul>

  <h2>Permissions, and what each is for</h2>
  <table>
    <tr><th>Permission</th><th>Used for</th></tr>
    <tr><td>Photos and videos</td><td>Choosing files to upload, and camera backup if you enable it</td></tr>
    <tr><td>Notifications</td><td>Telling you when something is shared with you or added to a folder</td></tr>
    <tr><td>Run at startup</td><td>Resuming interrupted uploads after your phone restarts</td></tr>
    <tr><td>Foreground service / background jobs</td><td>Finishing large uploads while the app is closed</td></tr>
    <tr><td>Network access</td><td>Talking to the drive, and waiting for Wi-Fi if you chose Wi-Fi-only uploads</td></tr>
  </table>

  <h2>Security</h2>
  <p>All traffic uses HTTPS. Sign-in tokens are stored only as hashes on the server, so a copy of the
  database does not reveal them. The drive is reachable only through an outbound tunnel, so the server
  has no open ports exposed to the internet.</p>

  <h2>Keeping and deleting your data</h2>
  <ul>
    <li>You can delete your account at any time from <strong>Settings → Delete account</strong> in the app.
        This removes your profile, your access to shared folders, your sessions and your notification
        devices immediately. See <a href="/delete-account">the deletion page</a> for details.</li>
    <li><strong>Files you uploaded stay on the owner's drive</strong>, because they belong to the drive,
        not to your account. Ask the owner first if you want specific files removed too.</li>
    <li>The activity log is ${retention}.</li>
  </ul>

  <h2>Children</h2>
  <p>Pocket Drive is not aimed at children and is not offered to them. Accounts exist only by the owner's
  personal invitation.</p>

  <h2>Changes</h2>
  <p>If this policy changes, the date at the top changes with it.</p>

  ${contact}
</main>
</body>
</html>`;
}
