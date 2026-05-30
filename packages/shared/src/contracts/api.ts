export type UserRole = 'agency_admin' | 'marketer' | 'client';

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

export type ApiError = {
  code: string;
  message: string;
};

export type AuthUser = {
  id: string;
  agency_id: string;
  client_id: string | null;
  email: string;
  role: UserRole;
};

export type LoginResponse = {
  token: string;
  user: AuthUser;
};
