export type SyncMeta = {
  removedRecords: { id: string; removedAt: string }[];
  goalSetAt: Record<string, string>;
};

/** Separate from the existing meal/goal ports and their stored shapes. */
export interface SyncMetaRepository {
  get(): Promise<SyncMeta>;
}
