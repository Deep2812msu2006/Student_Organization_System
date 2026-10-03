export class HttpError extends Error {
  constructor(status, code, message, fields) { super(message); Object.assign(this, { status, code, fields }); }
}
