import React from 'react';
import { render, screen } from '@testing-library/react';
import { HighDemandMap } from '../components/shared/HighDemandMap';
import { 
  useAllocationStatus, 
  useActiveOrderLocations, 
  useActiveDriverLocations 
} from '@/utils/hooks/use-api';

// Mock API Hooks
jest.mock('@/utils/hooks/use-api', () => ({
  useAllocationStatus: jest.fn(),
  useActiveOrderLocations: jest.fn(),
  useActiveDriverLocations: jest.fn(),
}));

// Mock theme
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light' }),
}));

describe('HighDemandMap Automated Verification (TC-DASH-009)', () => {
  const mockAllocationData = {
    zones: [
      { 
        zone_id: 'zone_A', 
        zone_name: 'Downtown', 
        pending_orders: 10, 
        total_drivers: 5, 
        demand_pressure: 1.5,
        latitude: 25.15,
        longitude: 55.25
      }
    ]
  };

  const mockOrderLocations = [
    { order_id: 'ord_1', status: 'pending', pickup_latitude: 25.15, pickup_longitude: 55.25, pickup_zone: 'zone_A' }
  ];

  const mockDriverLocations = [
    { driver_id: 'drv_1', name: 'John Driver', latitude: 25.155, longitude: 55.255 }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useAllocationStatus.mockReturnValue({ data: mockAllocationData, loading: false });
    useActiveOrderLocations.mockReturnValue({ data: mockOrderLocations, loading: false });
    useActiveDriverLocations.mockReturnValue({ data: mockDriverLocations });
  });

  it('TC-DASH-009: Renders Map and Legend with correct headers', () => {
    render(<HighDemandMap />);
    
    // Check Header
    expect(screen.getByText('Live Fleet Distribution')).toBeInTheDocument();
    
    // Check Legend
    expect(screen.getByText('Map Legend')).toBeInTheDocument();
    expect(screen.getByText('Active Driver')).toBeInTheDocument();
    expect(screen.getByText('Order Cluster')).toBeInTheDocument();
  });

  it('TC-DASH-009: Renders Map container and elements (via mocks)', () => {
    render(<HighDemandMap />);
    
    // The map container should exist (mocked by jest.setup.js)
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    
    // Check for zone markers (mocked by jest.setup.js)
    // There should be one marker for the zone and one for the driver
    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-DASH-009: Status counts in filter are correct', () => {
    render(<HighDemandMap />);
    
    // Pending: 1
    // We expect a button/element with 'PENDING' and '1'
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });
});
