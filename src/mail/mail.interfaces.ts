export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** What kind of mail this is, in a few words ("customer activation", "workflow SLA breach") — used only to label the log lines
   *  of a send so a support engineer can tell mails apart. Defaults to a generic "email". */
  purpose?: string;
}

export interface MailTemplateResult {
  subject: string;
  html: string;
  text: string;
  /** What kind of mail this template produces — becomes MailMessage.purpose, so each template names itself in the send log. */
  purpose: string;
}

/** Every template is a pure function: variables in, subject/html/text out — no SMTP or I/O
 *  concerns leak into template code, and a new email type is just a new file here plus one new
 *  event listener, never a change to MailService itself. */
export type MailTemplate<TVariables> = (variables: TVariables) => MailTemplateResult;
