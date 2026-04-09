import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AlertsScreen from '../app/(tabs)/alerts';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useSensors } from '../contexts/SensorContext';
import { useTheme } from '../contexts/ThemeContext';
import { getAlerts } from '../services/safety';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../contexts/SensorContext', () => ({
  useSensors: jest.fn(),
}));

jest.mock('../contexts/ThemeContext', () => ({
  useTheme: jest.fn(),
}));

jest.mock('../services/safety', () => ({
  getAlerts: jest.fn(),
  acknowledgeAlert: jest.fn(),
}));

// Mock lucide-react-native
jest.mock('lucide-react-native', () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
        AlertTriangleIcon: (props) => <View {...props} />,
        Bell: (props) => <View {...props} />,
        BellIcon: (props) => <View {...props} />,
        HeartPulseIcon: (props) => <View {...props} />,
        MapPinIcon: (props) => <View {...props} />,
        PackageIcon: (props) => <View {...props} />,
        User: (props) => <View {...props} />,
        Zap: (props) => <View {...props} />,
        Car: (props) => <View {...props} />,
        RefreshCw: (props) => <View {...props} />,
        Coffee: (props) => <View {...props} />,
        Clock: (props) => <View {...props} />,
        MapIcon: (props) => <View {...props} />,
        CheckCircle: (props) => <View {...props} />,
        XCircle: (props) => <View {...props} />,
        Edit3: (props) => <View {...props} />,
        Megaphone: (props) => <View {...props} />,
        Settings: (props) => <View {...props} />,
        Navigation: (props) => <View {...props} />,
    };
});

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
        SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    };
});

describe('AlertsScreen Fatigue Monitoring (TC-FAT-007)', () => {
    const mockAlerts = [
      {
        alert_id: 'alert_fatigue_1',
        alert_type: 'fatigue',
        severity: 'medium',
        message: 'High fatigue detected during check.',
        timestamp: '2026-04-08T14:30:00Z',
        acknowledged: false
      }
    ];
  
    beforeEach(() => {
      jest.clearAllMocks();
      useAuth.mockReturnValue({ token: 'fake-token' });
      useSensors.mockReturnValue({ riskPrediction: null });
      useTheme.mockReturnValue({ isDarkMode: false });
      useRouter.mockReturnValue({ push: jest.fn() });
      
      getAlerts.mockResolvedValue(mockAlerts);
    });
  
    it('TC-FAT-007: Fatigue alert is logged and visible in Alerts tab', async () => {
      const { getByText } = render(<AlertsScreen />);
      
      // Should show the title "Alerts"
      expect(getByText('Alerts')).toBeTruthy();

      await waitFor(() => {
          // Check for the fatigue alert title mapping
          expect(getByText(/Fatigue Detected/i)).toBeTruthy();
      });
    });
  });
