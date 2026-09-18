import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FileQuestion } from 'lucide-react-native';
import { useLayoutEffect } from 'react';
import { EmptyState } from '../components/ui';
import { PhotoView } from '../components/viewer/PhotoView';
import { TextView } from '../components/viewer/TextView';
import { VideoView } from '../components/viewer/VideoView';
import type { FilesStackParamList } from '../navigation/types';
import { previewKind } from '../shared/lib/entries';

type Props = NativeStackScreenProps<FilesStackParamList, 'Viewer'>;

export function ViewerScreen({ navigation, route }: Props) {
  const { entry } = route.params;
  const kind = previewKind(entry);

  useLayoutEffect(() => {
    // Dark header for immersive media; the file name stays as the title.
    navigation.setOptions({
      title: entry.name,
      headerStyle: { backgroundColor: kind === 'image' || kind === 'video' ? '#000' : undefined },
      headerTintColor: kind === 'image' || kind === 'video' ? '#fff' : undefined,
    });
  }, [navigation, entry.name, kind]);

  switch (kind) {
    case 'image':
      return <PhotoView entry={entry} />;
    case 'video':
    case 'audio':
      return <VideoView entry={entry} />;
    case 'text':
      return <TextView entry={entry} />;
    default:
      // PDF and other types: opening with the system app arrives with the downloads slice.
      return (
        <EmptyState
          icon={FileQuestion}
          title="Preview not available"
          message="This file type can’t be previewed in the app yet. Downloading and opening it with another app is coming next."
        />
      );
  }
}
