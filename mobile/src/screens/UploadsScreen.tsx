import { UploadCloud } from 'lucide-react-native';
import { EmptyState } from '../components/ui';

/** Placeholder until Phase 4 (the native uploader and Uploads queue) lands. */
export function UploadsScreen() {
  return (
    <EmptyState
      icon={UploadCloud}
      title="No uploads yet"
      message="Files you upload will show their progress here. Uploading arrives in a later update."
    />
  );
}
