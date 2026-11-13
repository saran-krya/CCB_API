# E-mail previews

Generated on 2026-11-12 by the running API (`POST /email-templates/preview`, the same renderer that sends the real e-mails) from the 12 built-in
templates, with the **default** brand (company name "CCB", header #1F2937, button #185FA5) and the sample values the editor's Preview uses (the link
in them does not work). Open the `.html` files in a browser; the `.txt` files are the plain-text alternatives that go out with each message.

| Message | Language | File | Subject (with the sample brand) |
|---|---|---|---|
| تفعيل الحساب | Arabic (right-to-left) | `account_activated-ar.html` | حسابك لدى CCB جاهز |
| Account Activated | English | `account_activated-en.html` | Your CCB account is ready |
| دعوة عميل (مبلغ التأمين) | Arabic (right-to-left) | `customer_deposit_invitation-ar.html` | أكمل إعداد حسابك لدى CCB — مطلوب مبلغ تأمين |
| Customer Invitation (Security Deposit) | English | `customer_deposit_invitation-en.html` | Complete your CCB account setup — Security Deposit required |
| دعوة عميل | Arabic (right-to-left) | `customer_invitation-ar.html` | فعّل حسابك كعميل لدى CCB |
| Customer Invitation | English | `customer_invitation-en.html` | Activate your CCB customer account |
| انتهاء صلاحية الدعوة | Arabic (right-to-left) | `invitation_expired-ar.html` | انتهت صلاحية دعوتك إلى CCB |
| Invitation Expired | English | `invitation_expired-en.html` | Your CCB invitation has expired |
| إعادة إرسال الدعوة | Arabic (right-to-left) | `invitation_resent-ar.html` | أُعيد إرسال دعوتك إلى CCB |
| Invitation Resent | English | `invitation_resent-en.html` | Your CCB invitation has been sent again |
| دعوة موظف | Arabic (right-to-left) | `staff_invitation-ar.html` | تمت دعوتك للانضمام إلى CCB |
| Staff Invitation | English | `staff_invitation-en.html` | You've been invited to join CCB |

- `custom-brand-example/` — four of them with an example custom brand (company "Acme Facilities", header #0F4C5C, button #0F6E56, footer sentences in both languages).
- `screenshots/` — the rendered HTML at 900 px (desktop) and 390 px (phone) in a browser.

The company name, logo, colours and footer are set by the administrator in **Email Templates > E-mail settings**; the values above are examples only.
