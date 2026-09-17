import { forwardRef, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

/** Labelled, themed text input with an optional error line. */
export const TextField = forwardRef<ComponentRef<typeof TextInput>, Props>(function TextFieldInner({ label, error, style, ...rest }, ref) {
  const { colors, radii, space } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      {label && (
        <AppText variant="label" tone="muted">
          {label}
        </AppText>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radii.md,
            paddingHorizontal: space[4],
          },
          style,
        ]}
        {...rest}
      />
      {error && (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  input: { minHeight: 50, borderWidth: 1, fontSize: 16 },
});
