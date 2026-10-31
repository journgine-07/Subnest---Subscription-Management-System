// Small error type so routes/utilities can say "return this HTTP status with this message".
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = message => new HttpError(400, message);
