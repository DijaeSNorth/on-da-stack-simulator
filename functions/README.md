# Report Cleanup Function Scaffold

This repo does not currently include a Firebase Functions project. Keep cleanup deployment separate from the frontend until a functions workspace is intentionally added.

Intended scheduled function:

- Runtime: Firebase Functions v2 scheduler.
- Schedule: daily.
- Query `reports` by `expiresAt`.
- Delete only reports where:
  - `expiresAt < now`
  - `cleanupEligible === true`
  - `retentionClass !== "legal_hold"`
  - `retentionClass !== "manual_export_only"`
- Delete in small batches.
- Preserve `reportClusters` until each cluster `expiresAt`.
- Write a `reportCleanupLog/{cleanupRunId}` summary.
- Do not include service account keys or secrets in source.

Example implementation outline:

```ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDatabase } from "firebase-admin/database";

export const cleanupExpiredReports = onSchedule("every 24 hours", async () => {
  const db = getDatabase();
  const now = Date.now();
  const snapshot = await db.ref("reports").orderByChild("expiresAt").endAt(now).limitToFirst(100).get();
  const updates: Record<string, null> = {};
  snapshot.forEach(child => {
    const report = child.val();
    if (
      report?.cleanupEligible === true &&
      report?.retentionClass !== "legal_hold" &&
      report?.retentionClass !== "manual_export_only"
    ) {
      updates[`reports/${child.key}`] = null;
    }
  });
  await db.ref().update(updates);
});
```
