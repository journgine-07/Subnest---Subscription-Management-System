import nodemailer from 'nodemailer';
export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
export async function sendMail({ to, subject, text }) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
}
