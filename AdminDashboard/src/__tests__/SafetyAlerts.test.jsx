import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SafetyAlerts } from '../components/SafetyAlerts/safetyAlertsComponent';
import { 
  useDrivers, 
  useSafetyAlerts, 
  usePolling, 
  useDriverPerformanceStats,
  useDriverInsights
} from '@/utils/hooks/use-api';
import { safetyService } from '@/utils/services/safety.service';

// Mock API Hooks
jest.mock('@/utils/hooks/use-api', () => ({
  useDrivers: jest.fn(),
  useSafetyAlerts: jest.fn(),
  usePolling: jest.fn(),
  useDriverPerformanceStats: jest.fn(),
  useDriverInsights: jest.fn()
}));

// Mock Safety Service
jest.mock('@/utils/services/safety.service', () => ({
  safetyService: {
    acknowledgeAlert: jest.fn()
  }
}));

// Mock DriverChatDialog
jest.mock('@/components/shared/DriverChatDialog', () => ({
  DriverChatDialog: () => <div data-testid="mock-chat-dialog" />
}));

// Mock UI components to avoid Radix UI rendering issues in JSDOM
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
  CardContent: ({ children, className }) => <div className={className}>{children}</div>,
  CardHeader: ({ children, className }) => <div className={className}>{children}</div>,
  CardTitle: ({ children, className }) => <div className={className}>{children}</div>,
  CardDescription: ({ children, className }) => <div className={className}>{children}</div>,
  CardFooter: ({ children, className }) => <div className={className}>{children}</div>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }) => <span className={className}>{children}</span>
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, variant, disabled }) => (
    <button onClick={onClick} className={className} data-variant={variant} disabled={disabled}>{children}</button>
  )
}));

jest.mock('@/components/ui/input', () => ({
  Input: (props) => <input {...props} />
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }) => (
    <select data-testid="mock-select" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }) => <>{children}</>,
  SelectValue: ({ placeholder }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, value, onValueChange }) => (
    <div data-active-tab={value} onClick={(e) => {
      if (e.target.dataset.tab) onValueChange(e.target.dataset.tab);
    }}>{children}</div>
  ),
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }) => <button data-tab={value}>{children}</button>,
  TabsContent: ({ children, value }) => <div data-testid={`tabs-content-${value}`} data-tab-content={value}>{children}</div>,
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }) => (open ? <div data-testid="mock-dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

jest.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
  AlertCircle: () => <span data-testid="icon-alert-circle" />,
  Activity: () => <span data-testid="icon-activity" />,
  Battery: () => <span data-testid="icon-battery" />,
  Camera: () => <span data-testid="icon-camera" />,
  CheckCircle: () => <span data-testid="icon-check-circle" />,
  Clock: () => <span data-testid="icon-clock" />,
  CloudRain: () => <span data-testid="icon-cloud-rain" />,
  Download: () => <span data-testid="icon-download" />,
  Eye: () => <span data-testid="icon-eye" />,
  MapPin: () => <span data-testid="icon-map-pin" />,
  Navigation: () => <span data-testid="icon-navigation" />,
  Package: () => <span data-testid="icon-package" />,
  Search: () => <span data-testid="icon-search" />,
  TrendingUp: () => <span data-testid="icon-trending-up" />,
  Wifi: () => <span data-testid="icon-wifi" />,
  Zap: () => <span data-testid="icon-zap" />,
  Loader2: () => <span data-testid="icon-loader2" />,
}));

describe('SafetyAlerts Automated Verification (Module 6.7.3)', () => {
  const mockAlerts = [
    {
      alert_id: 'ALR-001',
      alert_type: 'fatigue',
      driver_id: 'DRV-1021',
      driver_name: 'Ahmed Khan',
      severity: 4, // Critical
      timestamp: '2024-04-08T10:10:00', // Newer
      acknowledged: false
    },
    {
      alert_id: 'ALR-002',
      alert_type: 'speeding',
      driver_id: 'DRV-1034',
      driver_name: 'Mathew Joe',
      severity: 2, // Medium
      timestamp: '2024-04-08T10:05:00', // Older
      acknowledged: false
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useDrivers.mockReturnValue({ data: { drivers: [] }, loading: false });
    useSafetyAlerts.mockReturnValue({ data: mockAlerts, refetch: jest.fn() });
    useDriverPerformanceStats.mockReturnValue({ data: null });
    useDriverInsights.mockReturnValue({ data: null, loading: false });
  });

  it('TC-SAF-001: Renders alert cards with correct severity styling', () => {
    render(<SafetyAlerts />);
    
    expect(screen.getByText('Safety Alerts Panel')).toBeInTheDocument();
    
    // Check Ahmed Alert (Critical) - Look for the card with specific border color
    // We scope to ensure we are looking at the card, not the timeline
    const activeContent = screen.getByTestId('tabs-content-all');
    const criticalAlert = within(activeContent).getByText('Ahmed Khan').closest('div[style*="border-left-color: #ef4444"]');
    expect(criticalAlert).toBeInTheDocument();
    expect(within(criticalAlert).getByText('CRITICAL')).toBeInTheDocument();
  });

  it('TC-SAF-002/003: Filters alerts by severity and search query', () => {
    render(<SafetyAlerts />);
    
    // Search for DRV-1021
    const searchInput = screen.getByPlaceholderText(/search by driver/i);
    fireEvent.change(searchInput, { target: { value: 'DRV-1021' } });
    
    // Scope check to the active tab content
    const activeContent = screen.getByTestId('tabs-content-all');
    
    expect(within(activeContent).getByText('Ahmed Khan')).toBeInTheDocument();
    expect(within(activeContent).queryByText('Mathew Joe')).not.toBeInTheDocument();
    
    // Clear search and Filter by Severity (Medium)
    fireEvent.change(searchInput, { target: { value: '' } });
    // There are two selects (Severity and Sort), we want the first one
    const severitySelect = screen.getAllByTestId('mock-select')[0];
    fireEvent.change(severitySelect, { target: { value: 'medium' } });
    
    expect(within(activeContent).getByText('Mathew Joe')).toBeInTheDocument();
    expect(within(activeContent).queryByText('Ahmed Khan')).not.toBeInTheDocument();
  });

  it('TC-SAF-004: Acknowledge button triggers correct service call', async () => {
    const refetchMock = jest.fn();
    useSafetyAlerts.mockReturnValue({ data: mockAlerts, refetch: refetchMock });
    
    render(<SafetyAlerts />);
    
    // ALR-001 is newer (10:10), so it should be first in newest-first sorting
    const activeContent = screen.getByTestId('tabs-content-all');
    const acknowledgeButtons = within(activeContent).getAllByText('Acknowledge');
    fireEvent.click(acknowledgeButtons[0]);
    
    expect(safetyService.acknowledgeAlert).toHaveBeenCalledWith('ALR-001', true);
  });
});
