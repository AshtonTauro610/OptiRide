import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ZoneChangeScreen from '../app/zone-change';
import { useRouter, useLocalSearchParams } from 'expo-router';

// Mocks
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

describe('ZoneChangeScreen Interaction (TC-NA-004)', () => {
  let mockReplace;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReplace = jest.fn();
    useRouter.mockReturnValue({ replace: mockReplace, back: jest.fn() });
    useLocalSearchParams.mockReturnValue({ zoneId: 'zone_dubai_marina' });
  });

  it('TC-NA-004: Tapping "Navigate" button routes to Map tab', () => {
    const { getByText } = render(<ZoneChangeScreen />);
    
    const navigateButton = getByText('Navigate');
    fireEvent.press(navigateButton);

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/map');
  });
});
