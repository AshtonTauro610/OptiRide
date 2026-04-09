import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Analytics } from '../components/Analytics/analyticsComponent';
import * as apiHooks from '@/utils/hooks/use-api';

// Mock all API hooks used in Analytics
jest.mock('@/utils/hooks/use-api', () => ({
  useDriversSummary: jest.fn(),
  useDashboardOverview: jest.fn(),
  useRealtimeMetrics: jest.fn(),
  useFleetDashboardCharts: jest.fn(),
  useSafetyAlerts: jest.fn(),
  usePolling: jest.fn(),
  useAlertsSummary: jest.fn(),
  useSafetyScore: jest.fn(),
  useTopPerformers: jest.fn(),
  useDemandForecast: jest.fn(),
  useDemandHistory: jest.fn(),
  useZoneDemandHistory: jest.fn(),
  usePredictiveRisks: jest.fn()
}));

// Mock Recharts to avoid SVG rendering issues
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  AreaChart: () => <div data-testid="area-chart" />,
  Area: () => null,
  BarChart: () => <div data-testid="bar-chart" />,
  Bar: () => null,
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  PieChart: () => <div data-testid="pie-chart" />,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null
}));

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
  CardContent: ({ children, className }) => <div className={className}>{children}</div>,
  CardHeader: ({ children, className }) => <div className={className}>{children}</div>,
  CardTitle: ({ children, className }) => <div className={className}>{children}</div>,
  CardDescription: ({ children, className }) => <div className={className}>{children}</div>,
  CardFooter: ({ children, className }) => <div className={className}>{children}</div>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }) => <span className={className}>{children}</span>
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, defaultValue }) => <div data-active-tab={defaultValue}>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }) => <button data-tab={value}>{children}</button>,
  TabsContent: ({ children, value }) => <div data-testid={`tabs-content-${value}`} data-tab-content={value}>{children}</div>,
}));

jest.mock('lucide-react', () => ({
  TrendingUp: () => <span data-testid="icon-trending-up" />,
  TrendingDown: () => <span data-testid="icon-trending-down" />,
  Package: () => <span data-testid="icon-package" />,
  Clock: () => <span data-testid="icon-clock" />,
  Users: () => <span data-testid="icon-users" />,
  MapPin: () => <span data-testid="icon-map-pin" />,
  AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
  Activity: () => <span data-testid="icon-activity" />,
  Zap: () => <span data-testid="icon-zap" />,
  Brain: () => <span data-testid="icon-brain" />,
  CloudRain: () => <span data-testid="icon-cloud-rain" />,
  Target: () => <span data-testid="icon-target" />,
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Calendar: () => <span data-testid="icon-calendar" />,
}));

describe('AnalyticsDashboard Automated Verification (Module 6.7.4)', () => {
  const mockOverview = {
    total_orders: 1250,
    completed_orders: 1100,
    avg_delivery_time_min: 24.5,
    order_completion_rate: 88.0,
    driver_utilization_rate: 87,
    delivery_time_change_percent: -9.0, // improvement
    orders_change_percent: 15.0
  };

  const mockSafetyScore = {
    overall_score: 82,
    grade: 'B',
    trend_percentage: 5.4,
    total_incidents: 12
  };

  const mockRisks = {
    high_risk_zones: [
      { zone_id: 'Z-101', zone_name: 'Downtown', risk_level: 'Critical', reason: 'High demand vs low driver supply' }
    ],
    drivers_at_risk: [
      { driver_id: 'D-505', name: 'John Doe', risk_level: 'High', continuous_hours: 8.5 }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    apiHooks.useDashboardOverview.mockReturnValue({ data: mockOverview, refetch: jest.fn() });
    apiHooks.useDriversSummary.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useRealtimeMetrics.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useFleetDashboardCharts.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useSafetyAlerts.mockReturnValue({ data: [], refetch: jest.fn() });
    apiHooks.useAlertsSummary.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useSafetyScore.mockReturnValue({ data: mockSafetyScore, refetch: jest.fn() });
    apiHooks.useTopPerformers.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useDemandForecast.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useDemandHistory.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.useZoneDemandHistory.mockReturnValue({ data: null, refetch: jest.fn() });
    apiHooks.usePredictiveRisks.mockReturnValue({ data: mockRisks, refetch: jest.fn() });
  });

  it('TC-ANA-001: Renders Operational KPIs correctly', () => {
    render(<Analytics />);
    
    const operationalTab = screen.getByTestId('tabs-content-operational');
    
    expect(within(operationalTab).getByText('Avg Delivery Time (30d)')).toBeInTheDocument();
    expect(within(operationalTab).getByText('24.5 min')).toBeInTheDocument();
    expect(within(operationalTab).getByText('+9.0%')).toBeInTheDocument(); // deliveryTimeChangePct was -9, formatChange(-(-9)) = +9
    
    expect(within(operationalTab).getByText('Total Orders (30d)')).toBeInTheDocument();
    expect(within(operationalTab).getByText('1250')).toBeInTheDocument();
    
    expect(within(operationalTab).getByText('Avg Utilization (30d)')).toBeInTheDocument();
  });

  it('TC-ANA-003: Renders Safety Analytics metrics', () => {
    render(<Analytics />);
    
    const safetyTab = screen.getByTestId('tabs-content-safety');
    
    expect(within(safetyTab).getByText('Fleet Safety Score')).toBeInTheDocument();
    expect(within(safetyTab).getByText('82/100 (B)')).toBeInTheDocument();
    expect(within(safetyTab).getByText('+5.4%')).toBeInTheDocument();
  });

  it('TC-ANA-006/007: Renders Predictive AI risk lists', () => {
    render(<Analytics />);
    
    const predictiveTab = screen.getByTestId('tabs-content-predictive');
    
    // Check Zones
    expect(within(predictiveTab).getByText('High-Risk Zones')).toBeInTheDocument();
    expect(within(predictiveTab).getByText('Downtown')).toBeInTheDocument();
    expect(within(predictiveTab).getByText('Critical Risk')).toBeInTheDocument();
    
    // Check Drivers
    expect(within(predictiveTab).getByText('Drivers at Risk of Fatigue')).toBeInTheDocument();
    expect(within(predictiveTab).getByText('John Doe')).toBeInTheDocument();
    expect(within(predictiveTab).getByText('High')).toBeInTheDocument();
  });
});
