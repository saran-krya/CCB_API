import { EmailLocale, SYSTEM_TEMPLATE_KEY, SystemTemplateKey } from './email-template.constants';

export interface DefaultEmailTemplate {
  key: SystemTemplateKey;
  locale: EmailLocale;
  name: string;
  subject: string;
  /** The message body as an HTML fragment (the responsive layout, the brand header and the footer are added around it when it is rendered). */
  bodyHtml: string;
}

/**
 * The built-in templates, one per message and language: a heading, a greeting, the message, a call-to-action button, how long its link works, a
 * soft details panel, the link again as copyable text, and a short closing note under a hairline. They are plain HTML with {{placeholders}} and inline styles only (see TEMPLATE_PLACEHOLDER_INFO), so
 * they pass the template sanitizer unchanged and an administrator can edit them. The button takes its colour from `bgcolor="{{buttonColor}}"`,
 * which is how the "button colour" setting reaches it; its label is always white (the setting is refused if that would not be readable).
 *
 * Both languages are built from the same composer below, so an English and an Arabic message always have the same structure; an Arabic one is
 * laid out right to left (the layout sets the direction, and the helpers here mirror the few things that are not inherited: the details
 * panel's text alignment, the note's side rule, and letter-spacing, which would break Arabic letters apart).
 *
 * They are written to the database once, on the first start after the feature is switched on, and are also what a missing or switched-off
 * template falls back to — so an invitation can always be sent.
 */

// Fixed palette of the message body (the brand colour of the header and the button colour are the configurable ones).
const HEADING = '#111827';
const TEXT = '#374151';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const PANEL = '#F8FAFC';
const LINK = '#185FA5';

const INVITATION_LINK = '{{invitationLink}}';
const SIGN_IN_LINK = '{{signInLink}}';

const heading = (html: string): string =>
  `<h1 style="margin:0 0 20px;color:${HEADING};font-size:24px;font-weight:700;line-height:1.3;">${html}</h1>`;

const p = (html: string): string => `<p style="margin:0 0 16px;color:${TEXT};font-size:15px;line-height:1.65;">${html}</p>`;

/** A value that may be written in either script, kept in its own direction inside the sentence. */
const strong = (html: string): string => `<strong dir="auto" style="color:${HEADING};">${html}</strong>`;

/** Label / value rows on a soft tinted panel (no borders). */
function details(rtl: boolean, rows: ReadonlyArray<readonly [label: string, value: string]>): string {
  const align = rtl ? 'right' : 'left';
  const body = rows
    .map(([label, value], index) => {
      const top = index === 0 ? 16 : 6;
      const bottom = index === rows.length - 1 ? 16 : 6;
      return (
        `<tr>` +
        `<td width="36%" valign="top" style="padding:${top}px 18px ${bottom}px;color:${MUTED};font-size:13px;line-height:1.5;text-align:${align};">${label}</td>` +
        `<td valign="top" style="padding:${top}px 18px ${bottom}px;color:${HEADING};font-size:14px;font-weight:600;line-height:1.5;text-align:${align};word-break:break-word;"><span dir="auto">${value}</span></td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:0 0 24px;border-radius:10px;border-collapse:separate;background-color:${PANEL};"><tbody>${body}</tbody></table>`
  );
}

/** The call-to-action: a button cell coloured by the setting, with a white label. */
const button = (rtl: boolean, href: string, label: string): string =>
  // A full-width wrapper cell carries the alignment (no floats), and the inner table is the button itself.
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px;"><tr><td align="${rtl ? 'right' : 'left'}">` +
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
  `<td align="center" bgcolor="{{buttonColor}}" style="border-radius:10px;">` +
  `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;border-radius:10px;color:#FFFFFF;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;">${label}</a>` +
  `</td></tr></table>` +
  `</td></tr></table>`;

/** A line of small print under the button (how long the link works). */
const smallPrint = (rtl: boolean, html: string): string =>
  `<p style="margin:0 0 24px;color:${MUTED};font-size:13px;line-height:1.6;text-align:${rtl ? 'right' : 'left'};">${html}</p>`;

/** "If the button doesn't work, copy this link": the link as text, always left-to-right, for a client that does not show the button. */
function linkNote(rtl: boolean, label: string, href: string): string {
  const align = rtl ? 'right' : 'left';
  return (
    `<p style="margin:0 0 4px;color:${MUTED};font-size:12px;line-height:1.6;text-align:${align};">${label}</p>` +
    `<p dir="ltr" style="margin:0 0 28px;font-size:12px;line-height:1.6;text-align:${align};word-break:break-all;">` +
    `<a href="${href}" target="_blank" style="color:${LINK};text-decoration:underline;">${href}</a></p>`
  );
}

/** A hairline that separates the message from its closing note. */
const divider = (): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>` +
  `<td height="1" style="height:1px;border-top:1px solid ${LINE};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`;

/** The closing note, in small print. */
const footnote = (rtl: boolean, html: string): string =>
  `<p style="margin:0;color:${MUTED};font-size:12px;line-height:1.6;text-align:${rtl ? 'right' : 'left'};">${html}</p>`;

interface Message {
  subject: string;
  heading: string;
  intro: string;
  /** A second paragraph, where a message has one. */
  intro2?: string;
  /** The label of the call-to-action button; a message without one has no button and no link. */
  button?: string;
  /** The closing note (a message that carries a link adds "this link works once" before it). */
  footnote: string;
}

interface Copy {
  names: Record<SystemTemplateKey, string>;
  greeting: string;
  singleUse: string;
  copyLink: string;
  labels: { account: string; invitedBy: string; expires: string; reference: string; deposit: string; status: string };
  depositStatus: string;
  staff: Message;
  customer: Message;
  deposit: Message;
  resent: Message;
  expired: Message;
  activated: Message;
}

const EN: Copy = {
  names: {
    [SYSTEM_TEMPLATE_KEY.STAFF_INVITATION]: 'Staff Invitation',
    [SYSTEM_TEMPLATE_KEY.CUSTOMER_INVITATION]: 'Customer Invitation',
    [SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION]: 'Customer Invitation (Security Deposit)',
    [SYSTEM_TEMPLATE_KEY.INVITATION_RESENT]: 'Invitation Resent',
    [SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED]: 'Invitation Expired',
    [SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED]: 'Account Activated',
  },
  greeting: 'Hello {{firstName}},',
  singleUse: 'This link can be used only once.',
  copyLink: "If the button doesn't work, copy this link into your browser:",
  labels: {
    account: 'Account',
    invitedBy: 'Invited by',
    expires: 'Link expires',
    reference: 'Customer reference',
    deposit: 'Security Deposit',
    status: 'Account status',
  },
  depositStatus: 'Activates once the deposit payment is verified',
  staff: {
    subject: "You've been invited to join {{companyName}}",
    heading: "You're invited to join {{companyName}}",
    intro: `${strong('{{invitedBy}}')} has created a staff account for you on {{companyName}}. Accept the invitation to confirm your email address and choose your own password.`,
    button: 'Accept invitation',
    footnote: "If you weren't expecting this invitation, you can safely ignore this email. Nothing is activated unless you accept it.",
  },
  customer: {
    subject: 'Activate your {{companyName}} customer account',
    heading: 'Your account has been approved',
    intro: 'Your customer account with {{companyName}} has been approved. Choose your own password to activate it and sign in to the customer portal.',
    button: 'Activate my account',
    footnote: "If you didn't register with us, you can safely ignore this email. Nothing is activated unless you accept the invitation.",
  },
  deposit: {
    subject: 'Complete your {{companyName}} account setup — Security Deposit required',
    heading: 'Your account has been approved',
    intro: `Your customer account (${strong('{{customerReference}}')}) with {{companyName}} has been approved. A Security Deposit of ${strong('{{depositAmount}}')} is required before your account can be activated.`,
    intro2: 'Use the secure link below to set your password and complete the deposit payment.',
    button: 'Set password &amp; pay deposit',
    footnote: "Your account will be activated once the deposit payment is verified. If you didn't expect this email, you can safely ignore it.",
  },
  resent: {
    subject: 'Your {{companyName}} invitation has been sent again',
    heading: 'Here is your new invitation link',
    intro: `${strong('{{invitedBy}}')} sent your invitation again. The earlier link no longer works, so please use the new one below.`,
    button: 'Accept invitation',
    footnote: "If you weren't expecting this invitation, you can safely ignore this email.",
  },
  expired: {
    subject: 'Your {{companyName}} invitation has expired',
    heading: 'This invitation has expired',
    intro: `The invitation to join {{companyName}} that was sent to ${strong('{{email}}')} was not accepted in time, so its link no longer works and nothing was activated.`,
    intro2: `If you still need access, ask ${strong('{{invitedBy}}')} or your administrator to send you a new invitation.`,
    footnote: 'For your security, invitation links are valid for a limited time only. If you no longer need access, no action is needed.',
  },
  activated: {
    subject: 'Your {{companyName}} account is ready',
    heading: 'Your account is ready',
    intro: `Thank you, {{firstName}}. Your password has been set and your account is now active. Sign in with ${strong('{{email}}')} and the password you just chose.`,
    button: 'Sign in',
    footnote: "If you didn't set up this account, contact your administrator right away.",
  },
};

const AR: Copy = {
  names: {
    [SYSTEM_TEMPLATE_KEY.STAFF_INVITATION]: 'دعوة موظف',
    [SYSTEM_TEMPLATE_KEY.CUSTOMER_INVITATION]: 'دعوة عميل',
    [SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION]: 'دعوة عميل (مبلغ التأمين)',
    [SYSTEM_TEMPLATE_KEY.INVITATION_RESENT]: 'إعادة إرسال الدعوة',
    [SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED]: 'انتهاء صلاحية الدعوة',
    [SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED]: 'تفعيل الحساب',
  },
  greeting: 'مرحباً {{firstName}}،',
  singleUse: 'يمكن استخدام هذا الرابط مرة واحدة فقط.',
  copyLink: 'إذا لم يعمل الزر، انسخ هذا الرابط والصقه في المتصفح:',
  labels: {
    account: 'الحساب',
    invitedBy: 'تمت الدعوة بواسطة',
    expires: 'ينتهي الرابط',
    reference: 'رقم العميل',
    deposit: 'مبلغ التأمين',
    status: 'حالة الحساب',
  },
  depositStatus: 'يُفعَّل الحساب بعد التحقق من دفع مبلغ التأمين',
  staff: {
    subject: 'تمت دعوتك للانضمام إلى {{companyName}}',
    heading: 'أنت مدعو للانضمام إلى {{companyName}}',
    intro: `أنشأ ${strong('{{invitedBy}}')} حساب موظف لك على {{companyName}}. اقبل الدعوة لتأكيد بريدك الإلكتروني واختيار كلمة المرور الخاصة بك.`,
    button: 'قبول الدعوة',
    footnote: 'إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذا البريد بأمان. لن يتم تفعيل أي شيء ما لم تقبل الدعوة.',
  },
  customer: {
    subject: 'فعّل حسابك كعميل لدى {{companyName}}',
    heading: 'تمت الموافقة على حسابك',
    intro: 'تمت الموافقة على حسابك كعميل لدى {{companyName}}. اختر كلمة المرور الخاصة بك لتفعيله وتسجيل الدخول إلى بوابة العملاء.',
    button: 'تفعيل حسابي',
    footnote: 'إذا لم تقم بالتسجيل لدينا، يمكنك تجاهل هذا البريد بأمان. لن يتم تفعيل أي شيء ما لم تقبل الدعوة.',
  },
  deposit: {
    subject: 'أكمل إعداد حسابك لدى {{companyName}} — مطلوب مبلغ تأمين',
    heading: 'تمت الموافقة على حسابك',
    intro: `تمت الموافقة على حسابك كعميل (${strong('{{customerReference}}')}) لدى {{companyName}}. يلزم دفع مبلغ تأمين قدره ${strong('{{depositAmount}}')} قبل تفعيل حسابك.`,
    intro2: 'استخدم الرابط الآمن أدناه لتعيين كلمة المرور وإتمام دفع مبلغ التأمين.',
    button: 'تعيين كلمة المرور ودفع التأمين',
    footnote: 'سيتم تفعيل حسابك بعد التحقق من دفع مبلغ التأمين. إذا لم تكن تتوقع هذا البريد، يمكنك تجاهله بأمان.',
  },
  resent: {
    subject: 'أُعيد إرسال دعوتك إلى {{companyName}}',
    heading: 'هذا هو رابط الدعوة الجديد',
    intro: `أعاد ${strong('{{invitedBy}}')} إرسال دعوتك. لم يعد الرابط السابق يعمل، لذا يرجى استخدام الرابط الجديد أدناه.`,
    button: 'قبول الدعوة',
    footnote: 'إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذا البريد بأمان.',
  },
  expired: {
    subject: 'انتهت صلاحية دعوتك إلى {{companyName}}',
    heading: 'انتهت صلاحية هذه الدعوة',
    intro: `لم تُقبل الدعوة المرسلة إلى ${strong('{{email}}')} للانضمام إلى {{companyName}} في الوقت المحدد، لذلك لم يعد رابطها يعمل ولم يتم تفعيل أي شيء.`,
    intro2: `إذا كنت لا تزال بحاجة إلى الوصول، فاطلب من ${strong('{{invitedBy}}')} أو من مسؤول النظام إرسال دعوة جديدة.`,
    footnote: 'حرصاً على أمانك، روابط الدعوة صالحة لفترة محدودة فقط. إذا لم تعد بحاجة إلى الوصول، فلا حاجة لأي إجراء.',
  },
  activated: {
    subject: 'حسابك لدى {{companyName}} جاهز',
    heading: 'حسابك جاهز',
    intro: `شكراً {{firstName}}. تم تعيين كلمة المرور وأصبح حسابك نشطاً. سجّل الدخول باستخدام ${strong('{{email}}')} وكلمة المرور التي اخترتها للتو.`,
    button: 'تسجيل الدخول',
    footnote: 'إذا لم تقم بإعداد هذا الحساب، فتواصل مع مسؤول النظام فوراً.',
  },
};

/** The six messages of one language, in the order the Email Templates screen lists them. */
function compose(locale: EmailLocale, copy: Copy): DefaultEmailTemplate[] {
  const rtl = locale === 'ar';
  const { labels } = copy;

  /** A message that carries the single-use link: heading, greeting, text, the button, how long the link works, the details, the link as text, a note. */
  const withLink = (message: Message, rows: ReadonlyArray<readonly [string, string]>, href: string): string =>
    [
      heading(message.heading),
      p(copy.greeting),
      p(message.intro),
      ...(message.intro2 ? [p(message.intro2)] : []),
      button(rtl, href, message.button ?? ''),
      smallPrint(rtl, `${copy.singleUse} ${labels.expires}: <span dir="auto">{{expiryTime}}</span>`),
      ...(rows.length > 0 ? [details(rtl, rows)] : []),
      linkNote(rtl, copy.copyLink, href),
      divider(),
      footnote(rtl, message.footnote),
    ].join('\n');

  const account = [labels.account, '{{email}}'] as const;
  const invitedBy = [labels.invitedBy, '{{invitedBy}}'] as const;

  const template = (key: SystemTemplateKey, message: Message, bodyHtml: string): DefaultEmailTemplate => ({
    key,
    locale,
    name: copy.names[key],
    subject: message.subject,
    bodyHtml,
  });

  return [
    template(SYSTEM_TEMPLATE_KEY.STAFF_INVITATION, copy.staff, withLink(copy.staff, [account, invitedBy], INVITATION_LINK)),
    template(SYSTEM_TEMPLATE_KEY.CUSTOMER_INVITATION, copy.customer, withLink(copy.customer, [account], INVITATION_LINK)),
    template(
      SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION,
      copy.deposit,
      withLink(
        copy.deposit,
        [[labels.reference, '{{customerReference}}'], [labels.deposit, '{{depositAmount}}'], account, [labels.status, copy.depositStatus]],
        INVITATION_LINK,
      ),
    ),
    template(SYSTEM_TEMPLATE_KEY.INVITATION_RESENT, copy.resent, withLink(copy.resent, [account, invitedBy], INVITATION_LINK)),
    template(
      SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED,
      copy.expired,
      // Nothing to click: the link is dead, so this message has no button and no link — only what to do next.
      [heading(copy.expired.heading), p(copy.greeting), p(copy.expired.intro), p(copy.expired.intro2 ?? ''), divider(), footnote(rtl, copy.expired.footnote)].join('\n'),
    ),
    template(
      SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED,
      copy.activated,
      [
        heading(copy.activated.heading),
        p(copy.greeting),
        p(copy.activated.intro),
        button(rtl, SIGN_IN_LINK, copy.activated.button ?? ''),
        linkNote(rtl, copy.copyLink, SIGN_IN_LINK),
        divider(),
        footnote(rtl, copy.activated.footnote),
      ].join('\n'),
    ),
  ];
}

export const DEFAULT_EMAIL_TEMPLATES: readonly DefaultEmailTemplate[] = [...compose('en', EN), ...compose('ar', AR)];

/** The built-in default for a message in a language, or undefined for a key that has none. */
export function findDefaultTemplate(key: string, locale: string): DefaultEmailTemplate | undefined {
  return DEFAULT_EMAIL_TEMPLATES.find((template) => template.key === key && template.locale === locale);
}
