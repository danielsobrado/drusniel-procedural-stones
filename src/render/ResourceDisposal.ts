export interface DisposableResource {
  dispose(): void;
}

/** Attempts every owned cleanup and rethrows the first failure afterwards. */
export function disposeResources(
  resources: readonly (DisposableResource | undefined)[],
): void {
  let firstError: unknown;
  let failed = false;

  for (const resource of resources) {
    if (!resource) {
      continue;
    }
    try {
      resource.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }

  if (failed) {
    throw firstError;
  }
}
