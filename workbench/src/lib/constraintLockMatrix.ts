import type { ConstraintParamLockRecord, MatrixLockCapabilities } from "../api";

export function matrixCellKey(entityId: string, constraintId: string): string {
  return `${entityId}|${constraintId}`;
}

export function isCellLocked(locks: Map<string, boolean>, entityId: string, constraintId: string): boolean {
  return locks.get(matrixCellKey(entityId, constraintId)) ?? true;
}

export function matrixRowIds(capabilities: MatrixLockCapabilities): string[] {
  const globalId = capabilities.global_entity_id ?? "__global__";
  return [globalId, ...capabilities.entities];
}

export function serializeSparseLocks(
  locks: Map<string, boolean>,
  capabilities: MatrixLockCapabilities,
): ConstraintParamLockRecord[] {
  const sparse: ConstraintParamLockRecord[] = [];
  for (const entityId of matrixRowIds(capabilities)) {
    for (const constraint of capabilities.constraints) {
      if (!capabilities.applicability[entityId]?.[constraint.id]) continue;
      if (!isCellLocked(locks, entityId, constraint.id)) {
        sparse.push({ entity_id: entityId, constraint_id: constraint.id, locked: false });
      }
    }
  }
  return sparse;
}

export function formatUnlockWarning(warning: string): string {
  if (warning.startsWith("precedence_locked_only:")) {
    return `Precedence constraint ${warning.split(":")[1]} is locked-only in v1.`;
  }
  if (warning.startsWith("constraint_unlock_not_solver_encoded:")) {
    return `Constraint ${warning.split(":")[1]} unlock is not yet solver-encoded (warning only).`;
  }
  return warning;
}
