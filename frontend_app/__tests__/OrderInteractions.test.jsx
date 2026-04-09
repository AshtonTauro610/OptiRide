import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import OrderNotificationScreen from '../app/order-notification';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useOrderNotification } from '../contexts/OrderNotificationContext';
import { useOrders } from '../contexts/OrdersContext';
import { acceptOrder, rejectOrder } from '../services/orders';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../contexts/OrderNotificationContext', () => ({
  useOrderNotification: jest.fn(),
}));

jest.mock('../contexts/OrdersContext', () => ({
  useOrders: jest.fn(),
}));

jest.mock('../services/orders', () => ({
  acceptOrder: jest.fn(),
  rejectOrder: jest.fn(),
}));

jest.mock('../services/route', () => ({
  fetchDeliveryRoute: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 25.0, longitude: 55.0 }
  })),
  Accuracy: { Balanced: 2 },
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

describe('OrderNotificationScreen (TC-ORD-003, 005)', () => {
  let mockRouter;
  let mockInvalidateOrders;
  let mockClearCurrentOffer;

  const mockOrder = {
    order_id: 'order_123',
    restaurant_name: 'China Bistro',
    pickup_address: '123 Street',
    dropoff_address: '456 Avenue',
    customer_name: 'John Doe',
    delivery_fee: 15.50
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter = { replace: jest.fn() };
    mockInvalidateOrders = jest.fn();
    mockClearCurrentOffer = jest.fn();

    useRouter.mockReturnValue(mockRouter);
    useLocalSearchParams.mockReturnValue({ orderId: 'order_123' });
    useAuth.mockReturnValue({ token: 'fake-token' });
    useOrderNotification.mockReturnValue({
      currentOffer: mockOrder,
      clearCurrentOffer: mockClearCurrentOffer
    });
    useOrders.mockReturnValue({
      orders: [],
      invalidateOrders: mockInvalidateOrders
    });
  });

  it('TC-ORD-003: Tapping "ACCEPT" triggers acceptOrder and navigates to fatigue detection', async () => {
    acceptOrder.mockResolvedValue({ success: true });
    
    const { getByText } = render(<OrderNotificationScreen />);
    
    await act(async () => {
      fireEvent.press(getByText("ACCEPT"));
    });

    expect(acceptOrder).toHaveBeenCalledWith('fake-token', 'order_123');
    expect(mockInvalidateOrders).toHaveBeenCalled();
    expect(mockClearCurrentOffer).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/fatigue-detection',
        params: { orderId: 'order_123' }
    });
  });

  it('TC-ORD-005: Tapping "DECLINE" triggers rejectOrder and navigates to orders list', async () => {
    rejectOrder.mockResolvedValue({ success: true });
    
    const { getByText } = render(<OrderNotificationScreen />);
    
    await act(async () => {
      fireEvent.press(getByText("DECLINE"));
    });

    expect(rejectOrder).toHaveBeenCalledWith('fake-token', 'order_123');
    expect(mockClearCurrentOffer).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/orders');
  });
});
