import { ChevronRight } from 'lucide-react-native';
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './ui';

export interface Crumb {
  name: string;
  path: string;
}

/** The trail from the user's home down to `path`. Members can't go above the folder shared with them. */
export function buildCrumbs(path: string, isOwner: boolean, accessRoot: string | null): Crumb[] {
  const home: Crumb = { name: isOwner ? 'My Drive' : 'Shared with me', path: '' };
  if (!path) return [home];
  const crumbs: Crumb[] = [home];
  let acc = '';
  for (const seg of path.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ name: seg, path: acc });
  }
  if (!isOwner && accessRoot) {
    return crumbs.filter((c) => c.path === '' || c.path === accessRoot || c.path.startsWith(`${accessRoot}/`));
  }
  return crumbs;
}

interface Props {
  path: string;
  isOwner: boolean;
  accessRoot: string | null;
  onNavigate: (crumb: Crumb) => void;
}

export function Breadcrumbs({ path, isOwner, accessRoot, onNavigate }: Props) {
  const { colors, space } = useTheme();
  const crumbs = buildCrumbs(path, isOwner, accessRoot);
  if (crumbs.length <= 1) return null; // at home, the header title is enough

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.bar, { borderBottomColor: colors.border }]}
      contentContainerStyle={[styles.row, { paddingHorizontal: space[4], gap: space[1] }]}
    >
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={crumb.path || 'home'}>
            {i > 0 && <ChevronRight size={14} color={colors.muted} />}
            <Pressable disabled={last} onPress={() => onNavigate(crumb)} hitSlop={6} accessibilityRole="button">
              <AppText variant="caption" tone={last ? 'default' : 'primary'} numberOfLines={1}>
                {crumb.name}
              </AppText>
            </Pressable>
          </Fragment>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', minHeight: 40 },
});
