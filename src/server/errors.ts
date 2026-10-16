import "server-only";
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}
