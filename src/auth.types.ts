export interface AuthUser {
  username: string;
  role: string;
}

declare module 'express-session' {
  interface SessionData {
    user?: AuthUser;
  }
}
