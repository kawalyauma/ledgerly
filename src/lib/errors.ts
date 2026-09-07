export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const assertFound = <T>(value: T | null | undefined, message = "Resource not found"): T => {
  if (value == null) throw new AppError(404, "NOT_FOUND", message);
  return value;
};
