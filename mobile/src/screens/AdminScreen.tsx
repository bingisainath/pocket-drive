import { Shield } from 'lucide-react-native';
import { EmptyState } from '../components/ui';

/** Owner-only placeholder until Phase 5 (Share dialog, People & access, Activity log). */
export function AdminScreen() {
  return (
    <EmptyState
      icon={Shield}
      title="Admin"
      message="Sharing, people & access, and the activity log will live here in a later update."
    />
  );
}
