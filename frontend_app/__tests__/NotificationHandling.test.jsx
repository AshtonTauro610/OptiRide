import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { AllocationNotificationProvider } from '../contexts/AllocationNotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'expo-router';
import socket from '../services/socket';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../services/socket', () => ({
  on: jest.fn(),
  off: jest.fn(),
}));

describe('NotificationHandling Integration (TC-NA-001, 003)', () => {
  let mockPush;
  let socketCallbacks = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockPush = jest.fn();
    useRouter.mockReturnValue({ push: mockPush });
    useAuth.mockReturnValue({ isAuthenticated: true, token: 'fake-token' });
    
    // Capture socket callbacks
    socket.on.mockImplementation((event, callback) => {
      socketCallbacks[event] = callback;
    });
  });

  it('TC-NA-001/003: Redirects to zone-change screen on driver_allocated (Surge/Allocation)', async () => {
    render(
      <AllocationNotificationProvider>
        <React.Fragment />
      </AllocationNotificationProvider>
    );

    // Simulate socket event
    const allocationData = { 
      zone_id: 'zone_A', 
      latitude: 25.0, 
      longitude: 55.0,
      zone_name: 'Downtown'
    };
    
    if (socketCallbacks['driver_allocated']) {
      await act(async () => {
        socketCallbacks['driver_allocated'](allocationData);
      });
    }

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/zone-change',
        params: { zoneId: 'zone_A' },
      });
    });
  });
});
