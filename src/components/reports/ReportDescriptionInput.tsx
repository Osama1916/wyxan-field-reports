import {useState} from 'react';
import {Keyboard, StyleSheet, Text, TextInput, View} from 'react-native';
import {colors} from '../../theme/colors';
import {SectionCard} from '../common/SectionCard';

export type ReportDescriptionInputProps = {
  value: string;
  error: string | null;
  editable: boolean;
  onChangeText: (text: string) => void;
};

export function ReportDescriptionInput({
  value,
  error,
  editable,
  onChangeText,
}: ReportDescriptionInputProps) {
  const [focused, setFocused] = useState(false);
  const inputInvalid = error != null;

  return (
    <SectionCard>
      <Text accessibilityRole="text" style={styles.label}>
        Description{' '}
        <Text style={styles.requiredAsterisk} accessibilityLabel="required">
          *
        </Text>
      </Text>
      <Text style={styles.helperText}>Required — Please describe the issue.</Text>
      <TextInput
        accessibilityLabel="Report description, required"
        accessibilityHint="Required. Please describe the issue."
        editable={editable}
        multiline
        // Done / IME action dismisses only — never triggers Save.
        blurOnSubmit={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          Keyboard.dismiss();
        }}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder="What did you observe?"
        placeholderTextColor={colors.inkMuted}
        style={[
          styles.input,
          focused && styles.inputFocused,
          inputInvalid && styles.inputInvalid,
        ]}
        value={value}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.fieldError}>
          {error}
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.2,
  },
  requiredAsterisk: {
    color: colors.danger,
    fontWeight: '800',
  },
  helperText: {
    fontSize: 13,
    color: colors.inkMuted,
    lineHeight: 18,
  },
  input: {
    minHeight: 118,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: colors.surfaceMuted,
    color: colors.ink,
    textAlignVertical: 'top',
    fontSize: 16,
    lineHeight: 22,
  },
  inputFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.surface,
  },
  inputInvalid: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
});
