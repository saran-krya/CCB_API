/** Shared HTML shell for every outbound email — keeps per-template files focused on their own
 *  content instead of repeating the same boilerplate wrapper markup. Deliberately plain inline
 *  styles (no external stylesheet/CDN) since email clients strip <style> tags unpredictably. */
export function renderMailLayout(bodyHtml: string): string {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#F4F5F7;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F5F7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#1F2937;padding:20px 32px;">
                <span style="color:#FFFFFF;font-size:18px;font-weight:600;">Centrizen</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#1F2937;font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #E5E7EB;color:#6B7280;font-size:12px;">
                This is an automated message from Centrizen. Please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderMailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:6px;background-color:#378ADD;">
        <a href="${url}" target="_blank" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;
}
