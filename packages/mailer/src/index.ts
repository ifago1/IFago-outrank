export type { Mailer, SendEmailInput, SendEmailResult } from "./types.js";
export { PostmarkMailer } from "./postmark.js";
export type { PostmarkMailerOptions } from "./postmark.js";
export { SmtpMailer } from "./smtp.js";
export type { SmtpMailerOptions } from "./smtp.js";
export { MockMailer } from "./mock.js";
export { createMailer } from "./factory.js";
export type { CreateMailerInput, MailerProvider } from "./factory.js";
