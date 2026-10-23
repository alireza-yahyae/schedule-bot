// Error type shared by the API modules (a message the Mini App can show + an HTTP status).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function bad(msg: string): never {
  throw new ApiError(400, msg);
}
