import { Role } from "./domain-enums";

export const roleRank: Record<Role, number> = {
  STAFF: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
};

export function hasMinimumRole(role: Role, minimum: Role) {
  return roleRank[role] >= roleRank[minimum];
}

export function getHighestRole(roles: Role[]) {
  return roles.sort((left, right) => roleRank[right] - roleRank[left])[0] ?? "STAFF";
}

export function getDefaultRouteForRole(role: Role) {
  return hasMinimumRole(role, Role.SUPERVISOR) ? "/dashboard" : "/stock-count/swipe";
}

