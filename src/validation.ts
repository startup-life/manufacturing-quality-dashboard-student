export class InputError extends Error {
  status: number;
  declare code?: string;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
