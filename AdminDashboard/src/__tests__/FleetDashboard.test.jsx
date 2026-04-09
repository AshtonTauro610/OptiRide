import React from 'react';
import { render, screen } from '@testing-library/react';
import { FleetDashboard } from '../components/FleetDashboard/fleetDashboardComponent';
import { 
  useFleetDashboardCharts, 
  useDashboardOverview, 
  useDriversSummary, 
  useRealtimeMetrics 
} from '@/utils/hooks/use-api';

// Mock API Hooks
jest.mock('@/utils/hooks/use-api', () => ({
  useFleetDashboardCharts: jest.fn(),
  useDashboardOverview: jest.fn(),
  useDriversSummary: jest.fn(),
  useRealtimeMetrics: jest.fn(),
  usePolling: jest.fn(),
  useAllocationStatus: jest.fn(() => ({ data: null, loading: false })),
  useActiveOrderLocations: jest.fn(() => ({ data: [], loading: false })),
  useActiveDriverLocations: jest.fn(() => ({ data: [] })),
}));

// Mock HighDemandMap to isolate FleetDashboard tests
jest.mock('@/components/shared/HighDemandMap', () => ({
  HighDemandMap: () => <div data-testid="high-demand-map">Mocked Map</div>,
}));

// Mock theme
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}));

describe('FleetDashboard Automated Verification (TC-DASH-001, 002, 003, 007)', () => {
  const mockDashboardCharts = {
    hourly_stats: [{ time: '10:00', completed: 5, cancelled: 1, ongoing: 2 }],
    weekly_stats: [{ day: 'Mon', completed_orders: 50, efficiency: 85 }]
  };

  const mockDashboardOverview = {
    total_revenue: 5500,
    avg_delivery_time_min: 22.5,
    driver_utilization_rate: 78.2,
    order_completion_rate: 94.5,
    orders_change_percent: 5.2,
  };

  const mockRealtimeMetrics = {
    drivers_online: 15,
    drivers_available: 5,
    drivers_busy: 8,
    drivers_on_break: 2,
    orders_pending: 12,
    orders_in_progress: 8,
    orders_completed_today: 45,
    orders_per_hour: 4.2,
    avg_wait_time_min: 8.5,
    active_alerts: 1
  };

  const mockDriversSummary = {
    total_drivers: 20,
    offline_drivers: 5
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useFleetDashboardCharts.mockReturnValue({ data: mockDashboardCharts, refetch: jest.fn() });
    useDashboardOverview.mockReturnValue({ data: mockDashboardOverview, refetch: jest.fn() });
    useRealtimeMetrics.mockReturnValue({ data: mockRealtimeMetrics, refetch: jest.fn() });
    useDriversSummary.mockReturnValue({ data: mockDriversSummary, refetch: jest.fn() });
  });

  it('TC-DASH-001: Renders all metric cards with correct values', () => {
    render(<FleetDashboard />);
    
    // Check Top Metrics
    // Use getAllByText for counts that might appear in multiple places (Metric cards and summary)
    expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    
    expect(screen.getAllByText('Available Drivers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);

    // Check Second Row Metrics
    expect(screen.getByText('Completed Today')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText(/AED 5,500/)).toBeInTheDocument();
  });

  it('TC-DASH-002: Deliveries Today chart container exists', () => {
    render(<FleetDashboard />);
    expect(screen.getByText('Deliveries Today')).toBeInTheDocument();
    // Check for Recharts responsive container (mocked)
    expect(document.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('TC-DASH-003: Driver status distribution shows correct numbers', () => {
    render(<FleetDashboard />);
    expect(screen.getByText('Driver Status Distribution')).toBeInTheDocument();
    
    // Busy Drivers: 8
    expect(screen.getByText(/Active\/Busy/i)).toBeInTheDocument();
    expect(screen.getByText(/8 \(40\.0%\)/)).toBeInTheDocument();
    
    // Using specific regex for indicators in the distribution list
    // Using specific regex for indicators in the distribution list
    expect(screen.getAllByText(/^Active\/Busy$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Available$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 \(25\.0%\)/).length).toBeGreaterThan(0);
    
    // Total Fleet: 20
    expect(screen.getByText(/20 drivers/i)).toBeInTheDocument();
  });

  it('TC-DASH-007: Weekly Performance chart container exists', () => {
    render(<FleetDashboard />);
    expect(screen.getByText('Weekly Performance')).toBeInTheDocument();
    // Due to ResponsiveContainer mock, we just check existence and titles
    expect(screen.getByText('Efficiency %')).toBeInTheDocument();
    expect(screen.getByText('Total Deliveries')).toBeInTheDocument();
  });
});
