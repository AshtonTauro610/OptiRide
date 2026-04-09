import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import MapScreen from '../app/(tabs)/map';
import { useRouter } from 'expo-router';
import { useOrders } from '../contexts/OrdersContext';
import { useSensors } from '../contexts/SensorContext';
import { useAllocationNotification } from '../contexts/AllocationNotificationContext';
import { useTheme } from '../contexts/ThemeContext';
import { fetchMultiOrderRoute } from '../services/route';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../contexts/OrdersContext', () => ({
  useOrders: jest.fn(),
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

jest.mock('../services/route', () => ({
  fetchMultiOrderRoute: jest.fn(),
  fetchRouteDirections: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 25.0, longitude: 55.0 }
  })),
  Accuracy: { Balanced: 2, High: 4 },
}));

// Mock react-native-maps
jest.mock('react-native-maps', () => {
    const React = require('react');
    const { View } = require('react-native');
    class MockMapView extends React.Component {
      fitToCoordinates() {}
      render() { return <View {...this.props}>{this.props.children}</View>; }
    }
    class MockMarker extends React.Component {
      render() { return <View {...this.props}>{this.props.children}</View>; }
    }
    class MockPolyline extends React.Component {
        render() { return <View {...this.props} />; }
    }
    return {
      __esModule: true,
      default: MockMapView,
      Marker: MockMarker,
      Polyline: MockPolyline,
      PROVIDER_GOOGLE: 'google',
    };
});

describe('MapScreen Navigation Overlay (TC-NAV-005, 007)', () => {
  const mockOrder = {
    id: 'order_123',
    status: 'assigned',
    restaurant: 'China Bistro',
    pickupLatitude: 25.1,
    pickupLongitude: 55.1,
    dropoffLatitude: 25.2,
    dropoffLongitude: 55.2,
    details: { customerName: 'John Doe' }
  };

  const mockRoute = {
    totalDistance: 5.5,
    totalDuration: 12,
    toPickup: {
        distance: 2.0,
        duration: 5
    },
    toDropoff: {
        distance: 3.5,
        duration: 7
    },
    fullRoute: { coordinates: [] },
    isMultiStop: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useOrders.mockReturnValue({ orders: [mockOrder] });
    useSensors.mockReturnValue({
      isMonitoring: true,
      currentSpeed: 45,
      gyroscopeData: { x: 0, y: 0, z: 0 },
      locationData: { latitude: 25.0, longitude: 55.0 }
    });
    useAllocationNotification.mockReturnValue({ navigationTarget: null, clearNavigationTarget: jest.fn() });
    useTheme.mockReturnValue({ isDarkMode: false });
    
    fetchMultiOrderRoute.mockResolvedValue(mockRoute);
  });

  it('TC-NAV-005/007: Shows the navigation card with correct shop name and route stats', async () => {
    const { getByText } = render(<MapScreen />);
    
    await waitFor(() => {
      // Should show the shop name for pickup
      expect(getByText(/Pickup: China Bistro/i)).toBeTruthy();
      // Should show the distance/time
      expect(getByText(/2.0 km • 5 min to pickup/i)).toBeTruthy();
    });
  });
});
