export interface AuthenticatedUser {
  sub: number;
  email: string;
  roleId: number;
  roleName: string;
}
