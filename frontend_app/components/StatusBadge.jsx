import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/constants/theme';

export function StatusBadge({ status, label, style }) {
  const getColor = () => {
    switch (status) {
      case 'online':
      case 'low':
      case 'completed':
        return theme.colors.success;
      case 'medium':
      case 'pending':
      case 'pickup_ready':
        return theme.colors.warning;
      case 'high':
      case 'offline':
        return theme.colors.error;
      case 'assigned':
        return theme.colors.accent;
      default:
        return theme.colors.textSecondary;
    }
  };

  const backgroundColor = getColor();

  return (
    <View style={[styles.badge, { backgroundColor: `${backgroundColor}20` }, style]}>
      <View style={[styles.dot, { backgroundColor }]} />
      <Text style={[styles.text, { color: backgroundColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    marginRight: theme.spacing.xs,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
  },
});
