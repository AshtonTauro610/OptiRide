import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DriverMonitoring } from '../components/DriverMonitoring/driverMonitoringComponent';
import { 
  useDrivers, 
  usePolling, 
  useDriverPerformanceStats, 
  useAllocationStatus,
  useDriverInsights
} from '@/utils/hooks/use-api';

// Mock API Hooks
jest.mock('@/utils/hooks/use-api', () => ({
  useDrivers: jest.fn(),
  usePolling: jest.fn(),
  useDriverPerformanceStats: jest.fn(),
  useAllocationStatus: jest.fn(),
  useReallocateDriver: () => ({ reallocate: jest.fn(), loading: false }),
  useManualAllocate: () => ({ manualAllocate: jest.fn(), loading: false }),
  useInitialAllocation: () => ({ initialAllocation: jest.fn(), loading: false }),
  useDriverInsights: jest.fn()
}));

// Mock DriverChatDialog to avoid ScrollArea dependency issues
jest.mock('@/components/shared/DriverChatDialog', () => ({
  DriverChatDialog: () => <div data-testid="mock-chat-dialog" />
}));

// Mock UI components to avoid Radix UI rendering issues in JSDOM
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
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, disabled }) => (
    <button onClick={onClick} className={className} disabled={disabled}>{children}</button>
  )
}));
jest.mock('@/components/ui/input', () => ({
  Input: (props) => <input {...props} />
}));
jest.mock('@/components/ui/table', () => ({
  Table: ({ children }) => <table>{children}</table>,
  TableHeader: ({ children }) => <thead>{children}</thead>,
  TableBody: ({ children }) => <tbody>{children}</tbody>,
  TableRow: ({ children, className, onClick }) => <tr className={className} onClick={onClick}>{children}</tr>,
  TableHead: ({ children }) => <th>{children}</th>,
  TableCell: ({ children, className }) => <td className={className}>{children}</td>,
}));
jest.mock('@/components/ui/select', () => {
  return {
    Select: ({ children, onValueChange, value }) => (
      <select data-testid="mock-select" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
    ),
    SelectTrigger: ({ children }) => <>{children}</>,
    SelectValue: ({ placeholder }) => <option value="">{placeholder}</option>,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
  };
});
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }) => (open ? <div data-testid="mock-dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));
jest.mock('lucide-react', () => ({
  Search: () => <span data-testid="icon-search" />,
  Eye: () => <span data-testid="icon-eye" />,
  MessageSquare: () => <span data-testid="icon-messagesquare" />,
  MapPin: () => <span data-testid="icon-mappin" />,
  Navigation: () => <span data-testid="icon-navigation" />,
  Package: () => <span data-testid="icon-package" />,
  TrendingUp: () => <span data-testid="icon-trendingu" />,
  Clock: () => <span data-testid="icon-clock" />,
  Battery: () => <span data-testid="icon-battery" />,
  Wifi: () => <span data-testid="icon-wifi" />,
  Camera: () => <span data-testid="icon-camera" />,
  Activity: () => <span data-testid="icon-activity" />,
  Loader2: () => <span data-testid="icon-loader2" />,
}));

// Mock Sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('DriverMonitoring Automated Verification (Module 6.7.2)', () => {
  const mockDrivers = [
    {
      driver_id: 'DRV-001',
      name: 'Ahmed Khan',
      status: 'AVAILABLE',
      current_zone: 'Downtown',
      fatigue_level: 'NORMAL',
      fatigue_score: 0.2,
      current_speed: 45,
      updated_at: new Date().toISOString(),
      today_safety_score: 95,
      vehicle_plate: 'DXB-1234',
      email: 'ahmed@test.com'
    },
    {
      driver_id: 'DRV-002',
      name: 'John Smith',
      status: 'BUSY',
      current_zone: 'Business Bay',
      fatigue_level: 'SEVERE',
      fatigue_score: 0.85,
      current_speed: 60,
      updated_at: new Date().toISOString(),
      today_safety_score: 75,
      vehicle_plate: 'DXB-5678',
      email: 'john@test.com'
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useDrivers.mockReturnValue({
      data: { drivers: mockDrivers, total: 2 },
      loading: false,
      refetch: jest.fn()
    });
    useAllocationStatus.mockReturnValue({ data: { zones: [] }, loading: false });
    useDriverPerformanceStats.mockReturnValue({ data: null });
    useDriverInsights.mockReturnValue({ data: null, loading: false });
  });

  it('TC-MON-001: Renders the driver table with correct headers', () => {
    render(<DriverMonitoring />);
    
    expect(screen.getByText('Driver Monitoring System')).toBeInTheDocument();
    
    const headers = ['Driver', 'Status', 'Location', 'Fatigue Level', 'Speed', 'Last Activity', "Today's Safety Score", 'Actions'];
    headers.forEach(header => {
      expect(screen.getByText(header)).toBeInTheDocument();
    });
  });

  it('TC-MON-002/003: Correctly color-codes status and fatigue badges', () => {
    render(<DriverMonitoring />);
    
    // Ahmed - Available (success) & Normal (success)
    const ahmedRow = screen.getByText('Ahmed Khan').closest('tr');
    const ahmedStatus = within(ahmedRow).getByText('AVAILABLE');
    const ahmedFatigue = within(ahmedRow).getByText('NORMAL');
    
    expect(ahmedStatus).toHaveClass('bg-success/10');
    expect(ahmedFatigue).toHaveClass('bg-success/10');
    
    // John - Busy (primary) & Severe (destructive)
    const johnRow = screen.getByText('John Smith').closest('tr');
    const johnStatus = within(johnRow).getByText('BUSY');
    const johnFatigue = within(johnRow).getByText('SEVERE');
    
    expect(johnStatus).toHaveClass('bg-primary/10');
    expect(johnFatigue).toHaveClass('bg-destructive/10');
  });

  it('TC-MON-005: Filters table based on search query', () => {
    render(<DriverMonitoring />);
    
    const searchInput = screen.getByPlaceholderText(/search by name/i);
    
    // Search for Ahmed
    fireEvent.change(searchInput, { target: { value: 'Ahmed' } });
    
    expect(screen.getByText('Ahmed Khan')).toBeInTheDocument();
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
    
    // Search for John's ID
    fireEvent.change(searchInput, { target: { value: 'DRV-002' } });
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Khan')).not.toBeInTheDocument();
  });

  it('TC-MON-008: Opens Driver Details Modal on eye icon click', () => {
    render(<DriverMonitoring />);
    
    // Click Eye icon for Ahmed
    const ahmedRow = screen.getByText('Ahmed Khan').closest('tr');
    const viewButton = within(ahmedRow).getAllByRole('button')[0]; // The Eye button
    
    fireEvent.click(viewButton);
    
    // Check Modal Content
    expect(screen.getByText('Driver Profile: Ahmed Khan')).toBeInTheDocument();
    expect(screen.getByText('Real-time monitoring and safety insights')).toBeInTheDocument();
    expect(screen.getByText('Live GPS Tracking')).toBeInTheDocument();
  });
});
