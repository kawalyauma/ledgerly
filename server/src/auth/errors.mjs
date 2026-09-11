export class AuthError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
