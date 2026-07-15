/**
 * src/utils/unsubscribePageHtml.ts
 *
 * Branded unsubscribe confirmation page.
 * Served directly from Express — no SPA, no auth, no frontend server dependency.
 * Matches industry standard: Mailchimp, Sendgrid, HubSpot all use backend-rendered HTML.
 */

export interface UnsubscribePageOpts {
  /** True when the contact was already unsubscribed before this request */
  alreadyUnsubscribed?: boolean;
}

/**
 * Returns a complete, self-contained HTML document for the unsubscribe confirmation page.
 * Inline styles only — no external CSS dependencies.
 */
export function renderUnsubscribePage(opts: UnsubscribePageOpts = {}): string {
  const heading = opts.alreadyUnsubscribed
    ? 'Already Unsubscribed'
    : 'You have been unsubscribed.';

  const subtext = opts.alreadyUnsubscribed
    ? 'This address was already removed from our mailing list.'
    : 'You will no longer receive emails from this sequence.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:440px;width:100%;padding:48px 40px;text-align:center}
    .badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#16a34a;font-size:12px;font-weight:600;padding:4px 14px;border-radius:20px;margin-bottom:24px;border:1px solid #bbf7d0;letter-spacing:.02em}
    .icon-wrap{width:64px;height:64px;border-radius:50%;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .icon-wrap svg{width:28px;height:28px;stroke:#10b981;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
    h1{font-size:19px;font-weight:700;color:#111827;margin-bottom:10px;line-height:1.3}
    p{font-size:14px;color:#6b7280;line-height:1.7;margin-bottom:0}
    .divider{height:1px;background:#f3f4f6;margin:28px 0}
    .footnote{font-size:11px;color:#9ca3af;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Confirmed
    </div>
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1>${heading}</h1>
    <p>${subtext}<br>Your preference has been saved and takes effect immediately.</p>
    <div class="divider"></div>
    <p class="footnote">If you unsubscribed by mistake, please contact the sender directly to be re-added.</p>
  </div>
</body>
</html>`;
}
