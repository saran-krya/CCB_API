export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

/** Every template is a pure function: variables in, subject/html/text out — no SMTP or I/O
 *  concerns leak into template code, and a new email type is just a new file here plus one new
 *  event listener, never a change to MailService itself. */
export type MailTemplate<TVariables> = (variables: TVariables) => MailTemplateResult;
