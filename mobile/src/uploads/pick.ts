import { pick as pickDocs, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import { launchImageLibrary } from 'react-native-image-picker';

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  /** ms since epoch; used by the server to resume the same file. 0 when the picker doesn't report it. */
  lastModified: number;
}

/** System Photo Picker (no media permission needed) — photos and videos, multi-select. */
export async function pickPhotos(): Promise<PickedFile[]> {
  const res = await launchImageLibrary({ mediaType: 'mixed', selectionLimit: 0 });
  if (res.didCancel || !res.assets) return [];
  return res.assets
    .filter((a): a is typeof a & { uri: string } => Boolean(a.uri))
    .map((a) => ({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}`,
      size: a.fileSize ?? 0,
      lastModified: a.timestamp ? Date.parse(a.timestamp) || 0 : 0,
    }));
}

/** System document picker for any other file type, multi-select. */
export async function pickDocuments(): Promise<PickedFile[]> {
  try {
    const res = await pickDocs({ allowMultiSelection: true });
    return res
      .filter((f): f is typeof f & { uri: string } => Boolean(f.uri))
      .map((f) => ({ uri: f.uri, name: f.name ?? `file-${Date.now()}`, size: f.size ?? 0, lastModified: 0 }));
  } catch (err) {
    if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return [];
    throw err;
  }
}
