import { useMMKVString } from 'react-native-mmkv';
import { SORTS, type SortOrder } from '../shared/lib/entries';
import { storage, StorageKey } from './storage';

export type ViewMode = 'list' | 'grid';

/**
 * View preferences, persisted in MMKV and reactive (the screen re-renders on change). They're per
 * user because {@link storage} is wiped on sign-out / user change.
 */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [raw, setRaw] = useMMKVString(StorageKey.viewMode, storage);
  return [raw === 'grid' ? 'grid' : 'list', setRaw];
}

export function useSortOrder(): [SortOrder, (order: SortOrder) => void] {
  const [raw, setRaw] = useMMKVString(StorageKey.sortOrder, storage);
  const order = SORTS.includes(raw as SortOrder) ? (raw as SortOrder) : 'newest';
  return [order, setRaw];
}
