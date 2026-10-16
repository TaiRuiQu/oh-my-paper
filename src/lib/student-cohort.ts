/** School stage and cohort jointly identify a student group, independent of curriculum grade. */
export function cohortKey(scope: { stage: string; cohort: string }) {
  return JSON.stringify([scope.stage, scope.cohort]);
}

export function cohortLabel(scope: { stage: string; cohort: string }) {
  return `${scope.stage} · ${scope.cohort}`;
}
