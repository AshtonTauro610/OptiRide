import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { theme } from '@/constants/theme';

export function Button({ title, onPress, variant = 'primary', style, textStyle, disabled }) {
    const buttonColor = disabled
        ? '#9ca3af'
        : variant === 'success'
            ? theme.colors.success
            : variant === 'danger'
                ? theme.colors.error
                : variant === 'secondary'
                    ? '#6b7280'
                    : theme.colors.accent;

    return (
        <TouchableOpacity
            style={[styles.button, { backgroundColor: buttonColor }, style]}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.8}
        >
            <Text style={[styles.text, textStyle]}>{title}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.borderRadius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#ffffff',
        fontSize: theme.fontSize.base,
        fontWeight: '600',
    },
});
