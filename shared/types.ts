export const ROLES = ["user", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  user: "Regular user",
  editor: "Editor",
  admin: "Admin",
};

export interface User {
  id: number;
  username: string;
  role: Role;
  createdAt: string;
}
