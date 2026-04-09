import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import OrderDeliveryScreen from '../app/order-delivery';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useOrders } from '../contexts/OrdersContext';
import { useSensors } from '../contexts/SensorContext';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../contexts/OrdersContext', () => ({
  useOrders: jest.fn(),
}));

jest.mock('../contexts/SensorContext', () => ({
  useSensors: jest.fn(),
}));

// Mock polyline and location
jest.mock('@mapbox/polyline', () => ({
  decode: jest.fn(() => [[25.123, 55.456]]),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  Accuracy: { High: 4 },
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

describe('OrderDeliveryScreen (TC-ORD-006)', () => {
  let mockRouter;
  let mockCompleteDelivery;
  let mockStopMonitoring;

  const mockOrder = {
    id: 'order_123',
    orderNumber: 'ORD-001',
    location: '456 Avenue',
    status: 'assigned',
    details: { customerName: 'John Doe' },
    route_polyline: 'abc'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter = { replace: jest.fn(), back: jest.fn() };
    mockCompleteDelivery = jest.fn().mockResolvedValue({ success: true });
    mockStopMonitoring = jest.fn();

    useRouter.mockReturnValue(mockRouter);
    useLocalSearchParams.mockReturnValue({ orderId: 'order_123' });
    useOrders.mockReturnValue({
      orders: [mockOrder],
      isLoadingOrders: false,
      completeDelivery: mockCompleteDelivery
    });
    useSensors.mockReturnValue({
        isMonitoring: true,
        stopMonitoring: mockStopMonitoring
    });
  });

  it('TC-ORD-006: Tapping "Complete Delivery" triggers backend call, stops sensors, and navigates home', async () => {
    const { getByText } = render(<OrderDeliveryScreen />);
    
    await act(async () => {
      fireEvent.press(getByText("Complete Delivery"));
    });

    expect(mockCompleteDelivery).toHaveBeenCalledWith('order_123');
    expect(mockStopMonitoring).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });
});
