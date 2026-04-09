import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import HomeScreen from '../app/(tabs)/index';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useSensors } from '../contexts/SensorContext';
import { useAllocationNotification } from '../contexts/AllocationNotificationContext';
import { useTheme } from '../contexts/ThemeContext';
import { fetchDriverProfile, fetchDriverPerformanceStats } from '../services/driver';

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

jest.mock('../contexts/AllocationNotificationContext', () => ({
  useAllocationNotification: jest.fn(),
}));

jest.mock('../contexts/ThemeContext', () => ({
  useTheme: jest.fn(),
}));

jest.mock('../services/driver', () => ({
  fetchDriverProfile: jest.fn(),
  fetchDriverPerformanceStats: jest.fn(),
}));

// Mock react-native-maps
jest.mock('react-native-maps', () => {
    const React = require('react');
    const { View } = require('react-native');
    class MockMapView extends React.Component {
      render() { return <View {...this.props}>{this.props.children}</View>; }
    }
    class MockMarker extends React.Component {
      render() { return <View {...this.props}>{this.props.children}</View>; }
    }
    return {
      __esModule: true,
      default: MockMapView,
      Marker: MockMarker,
      PROVIDER_DEFAULT: 'default',
    };
});

describe('HomeScreen Zone Display (TC-NAV-001)', () => {
  const mockDriverProfile = {
    name: 'Test Driver',
    current_zone: 'zone_jumeirah',
    current_zone_demand: 0.5,
    latitude: 25.1,
    longitude: 55.1,
    status: 'available'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ token: 'fake-token' });
    useSensors.mockReturnValue({
      isOnline: true,
      toggleOnline: jest.fn(),
      isOnBreak: false,
      breakDuration: 0
    });
    useAllocationNotification.mockReturnValue({ newZone: null });
    useTheme.mockReturnValue({ isDarkMode: false });
    useRouter.mockReturnValue({ push: jest.fn() });
    
    fetchDriverProfile.mockResolvedValue(mockDriverProfile);
    fetchDriverPerformanceStats.mockResolvedValue({ today_orders: 5, today_earnings: 100 });
  });

  it('TC-NAV-001: Displays the formatted zone name on the home screen', async () => {
    const { getByText } = render(<HomeScreen />);
    
    await waitFor(() => {
      // "zone_jumeirah" should be formatted as "Zone Jumeirah"
      expect(getByText('Zone Jumeirah')).toBeTruthy();
    });
  });
});
