import '@testing-library/jest-dom';
import React from 'react';

// Mock Recharts
jest.mock('recharts', () => {
  const OriginalModule = jest.requireActual('recharts');
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }) => (
      <div className="recharts-responsive-container" style={{ width: '800px', height: '400px' }}>
        {children}
      </div>
    ),
  };
});

// Mock react-leaflet
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children, position }) => <div data-testid="marker" data-position={JSON.stringify(position)}>{children}</div>,
  Popup: ({ children }) => <div data-testid="popup">{children}</div>,
  useMap: () => ({
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
    setView: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
  }),
}));

// Mock Lucide icons
jest.mock('lucide-react', () => {
  const icons = {
    Users: 'Users',
    AlertTriangle: 'AlertTriangle',
    Package: 'Package',
    UserX: 'UserX',
    CheckCircle: 'CheckCircle',
    Clock: 'Clock',
    TrendingUp: 'TrendingUp',
    TrendingDown: 'TrendingDown',
    Activity: 'Activity',
    DollarSign: 'DollarSign',
    MapPin: 'MapPin',
    Navigation: 'Navigation',
    Filter: 'Filter',
    Search: 'Search',
    LogOut: 'LogOut',
    ZoomIn: 'ZoomIn',
    ZoomOut: 'ZoomOut',
    Locate: 'Locate',
    Menu: 'Menu',
    X: 'X',
  };

  const mockIcons = {};
  Object.keys(icons).forEach((key) => {
    mockIcons[key] = (props) => <span {...props} data-testid={`icon-${key.toLowerCase()}`} />;
  });
  return mockIcons;
});

// Mock resize observer
global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
}));

// Mock ScrollArea (Radix UI)
jest.mock('@radix-ui/react-scroll-area', () => ({
  Root: ({ children }) => <div>{children}</div>,
  Viewport: ({ children }) => <div>{children}</div>,
  Scrollbar: () => <div />,
  Thumb: () => <div />,
  Corner: () => <div />,
}));
