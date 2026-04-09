import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import FatigueDetectionScreen from '../app/fatigue-detection';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { useAuth } from '../contexts/AuthContext';
import { useSensors } from '../contexts/SensorContext';
import { submitSensorData } from '../services/safety';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

jest.mock('expo-camera', () => {
    const React = require('react');
    const { View } = require('react-native');
    class MockCameraView extends React.Component {
        takePictureAsync = jest.fn().mockResolvedValue({ base64: 'fake-base64-data' });
        render() { 
            return <View testID="camera-view" {...this.props}>{this.props.children}</View>; 
        }
    }
    return {
        CameraView: MockCameraView,
        useCameraPermissions: jest.fn(),
    };
});

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../contexts/SensorContext', () => ({
  useSensors: jest.fn(),
}));

jest.mock('../services/safety', () => ({
  submitSensorData: jest.fn(),
}));

describe('FatigueDetectionScreen Logic (TC-FAT-002, 003, 004)', () => {
  const mockRouter = { replace: jest.fn() };
  const mockUser = { driver_id: 'driver_1' };
  const mockToken = 'fake-token';

  beforeEach(() => {
    jest.clearAllMocks();
    useRouter.mockReturnValue(mockRouter);
    useLocalSearchParams.mockReturnValue({ orderId: '123' });
    useAuth.mockReturnValue({ token: mockToken, user: mockUser });
    useSensors.mockReturnValue({ startMonitoring: jest.fn(), isMonitoring: false });
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    // Use fake timers to handle redirections
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('TC-FAT-002: Shows "Fatigue check passed" and navigates to map on success (score < 0.65)', async () => {
    submitSensorData.mockResolvedValue({ fatigue_score: 0.1, recommendation: 'All good' });

    const { getByText, getByTestId } = render(<FatigueDetectionScreen />);

    // Trigger camera ready to start analysis
    act(() => {
        fireEvent(getByTestId('camera-view'), 'cameraReady');
    });

    await waitFor(() => {
      expect(getByText(/Fatigue check passed/i)).toBeTruthy();
    });

    // Fast-forward to handle the 2-second navigation delay
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/map');
  });

  it('TC-FAT-003: Hits "Critical Fatigue" and rejects to home (score > 0.80)', async () => {
    submitSensorData.mockResolvedValue({ 
        fatigue_score: 0.85, 
        recommendation: 'Critical fatigue! Order rejected.' 
    });

    const { getByText, getByTestId } = render(<FatigueDetectionScreen />);

    // Trigger camera ready to start analysis
    act(() => {
        fireEvent(getByTestId('camera-view'), 'cameraReady');
    });

    await waitFor(() => {
      expect(getByText(/Critical fatigue! Order rejected./i)).toBeTruthy();
    });

    // Fast-forward to handle the 3-second redirect delay
    act(() => {
      jest.advanceTimersByTime(3500);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('TC-FAT-004: Displays error message when camera permission is denied', async () => {
    useCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);

    const { getByText } = render(<FatigueDetectionScreen />);

    expect(getByText(/Camera permission required/i)).toBeTruthy();
  });
});
