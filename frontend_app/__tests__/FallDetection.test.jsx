import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import FallDetectionScreen from '../app/fall-detection';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { respondToEmergency } from '../services/safety';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../services/safety', () => ({
  respondToEmergency: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 25.0, longitude: 55.0 }
  })),
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
    return {
      __esModule: true,
      default: MockMapView,
      Marker: MockMarker,
      PROVIDER_GOOGLE: 'google',
    };
});

describe('FallDetectionScreen (TC-NA-005, 007, 008)', () => {
  let mockRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter = { back: jest.fn(), push: jest.fn() };
    useRouter.mockReturnValue(mockRouter);
    useLocalSearchParams.mockReturnValue({ title: 'FALL DETECTED!', message: 'Emergency alert.' });
    useAuth.mockReturnValue({ token: 'fake-token', user: { driver_id: 'driver_1' } });
  });

  it('TC-NA-005: Renders correctly with countdown timer', () => {
    const { getByText } = render(<FallDetectionScreen />);
    
    expect(getByText('FALL DETECTED!')).toBeTruthy();
    expect(getByText('60')).toBeTruthy(); // Initial countdown
    expect(getByText('seconds')).toBeTruthy();
  });

  it('TC-NA-007: Tapping "I\'M OKAY" triggers false_alarm and navigates back', async () => {
    const { getByText } = render(<FallDetectionScreen />);
    
    await act(async () => {
      fireEvent.press(getByText("I'M OKAY"));
    });

    expect(respondToEmergency).toHaveBeenCalledWith('fake-token', 'driver_1', 'false_alarm');
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('TC-NA-008: Tapping "CALL EMERGENCY" triggers confirmed response and navigates to assistance', async () => {
    const { getByText } = render(<FallDetectionScreen />);
    
    await act(async () => {
      fireEvent.press(getByText("CALL EMERGENCY"));
    });

    expect(respondToEmergency).toHaveBeenCalledWith('fake-token', 'driver_1', 'confirmed');
    expect(mockRouter.push).toHaveBeenCalledWith('/fall-assistance');
  });
});
