function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Branded email HTML. ALWAYS includes the CAN-SPAM footer: business name, a
 * visible one-click unsubscribe link, and the physical postal address. No send
 * path may bypass these (the guarded path also blocks if postal address missing).
 */
export function renderEmail(
  body: string,
  opts: { businessName: string; unsubUrl: string; postalAddress: string }
): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${esc(p)}</p>`)
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#f6f5fb;font-family:Inter,system-ui,sans-serif;color:#141221">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 10px 30px -18px rgba(79,56,255,.3)">
      <div style="font-weight:700;font-size:15px;margin-bottom:16px">${esc(opts.businessName)}</div>
      ${paragraphs}
    </div>
    <div style="text-align:center;color:#6b6880;font-size:12px;margin-top:16px;line-height:1.5">
      <p style="margin:0 0 6px">${esc(opts.businessName)}</p>
      <p style="margin:0 0 6px">${esc(opts.postalAddress)}</p>
      <p style="margin:0"><a href="${opts.unsubUrl}" style="color:#4F38FF">Unsubscribe</a></p>
    </div>
  </div></body></html>`;
}
