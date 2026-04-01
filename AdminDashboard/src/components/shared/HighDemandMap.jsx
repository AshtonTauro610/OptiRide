import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ZoomIn, ZoomOut, Locate, Navigation, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTheme } from "next-themes";
import { Popover, PopoverContent, PopoverTrigger, } from "@/components/ui/popover";
import { useAllocationStatus, useActiveOrderLocations, useActiveDriverLocations } from "@/utils/hooks/use-api";


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Order status colors
const statusColors = {
  pending: "#eab308", // Yellow
  offered: "#f97316", // Orange
  assigned: "#3b82f6", // Blue
  picked_up: "#6366f1", // Indigo
  delivered: "#22c55e", // Green
};


const getZoneColor = (index) => {
  const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#06b6d4"];
  return colors[index % colors.length];
};


const createZoneIcon = (color, count) => {
  return L.divIcon({
    className: "custom-zone-icon",
    html: `<div style="
      background-color: ${color};
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 11px;
      color: white;
    ">${count}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

// Cluster layer component
function ClusterLayer({ orders, visibleStatuses }) {
  const map = useMap();
  useEffect(() => {
    if (!orders || orders.length === 0) return;

    const clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => {
        const childCount = cluster.getChildCount();
        return L.divIcon({
          html: `<div style="
            background-color: #3b82f6;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 11px;
            color: white;
          ">${childCount}</div>`,
          className: "marker-cluster-custom",
          iconSize: L.point(32, 32),
        });
      },
    });

    const filteredOrders = orders.filter(o => visibleStatuses.includes(o.status));
    filteredOrders.forEach((order) => {
      const marker = L.circleMarker([order.pickup_latitude, order.pickup_longitude], {
        radius: 4,
        fillColor: statusColors[order.status] || "#94a3b8",
        color: "white",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8,
      });
      marker.options.orderStatus = order.status;
      marker.bindPopup(`
        <div style="font-size: 12px; padding: 4px;">
          <p style="font-weight: 600; margin: 0;">Order: ${order.order_id.substring(0, 8)}</p>
          <p style="margin: 4px 0 0 0; color: ${statusColors[order.status]}; text-transform: capitalize;">
            Status: ${order.status.replace('_', ' ')}
          </p>
          <p style="margin: 2px 0 0 0; color: #64748b;">
            Zone: ${order.pickup_zone || 'Unknown'}
          </p>
        </div>
      `);
      clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);
    return () => {
      map.removeLayer(clusterGroup);
    };
  }, [map, orders, visibleStatuses]);
  return null;
}

// Map controls component
function MapControls() {
  const map = useMap();
  return (<div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1">
    <Button size="icon" variant="secondary" className="h-8 w-8 bg-card/90 backdrop-blur-sm hover:bg-card shadow-md" onClick={() => map.zoomIn()}>
      <ZoomIn className="h-4 w-4" />
    </Button>
    <Button size="icon" variant="secondary" className="h-8 w-8 bg-card/90 backdrop-blur-sm hover:bg-card shadow-md" onClick={() => map.zoomOut()}>
      <ZoomOut className="h-4 w-4" />
    </Button>
    <Button size="icon" variant="secondary" className="h-8 w-8 bg-card/90 backdrop-blur-sm hover:bg-card shadow-md" onClick={() => map.setView([25.1500, 55.2500], 11)}>
      <Locate className="h-4 w-4" />
    </Button>
  </div>);
}

export function HighDemandMap() {
  const { data: allocationData, loading: allocationLoading } = useAllocationStatus();
  const { data: orderLocations, loading: ordersLoading } = useActiveOrderLocations();
  const { data: driverLocations } = useActiveDriverLocations();

  const [selectedZones, setSelectedZones] = useState([]);
  const [visibleStatuses, setVisibleStatuses] = useState(["pending", "offered", "assigned", "picked_up"]);

  const zones = useMemo(() => {
    if (!allocationData?.zones) return [];
    return allocationData.zones.map((z, index) => ({
      id: z.zone_id,
      name: z.zone_name,
      pending: z.pending_orders,
      drivers: z.total_drivers,
      pressure: z.demand_pressure,
      color: getZoneColor(index),
      lat: z.latitude || 25.15,
      lng: z.longitude || 55.25
    }));
  }, [allocationData]);

  useEffect(() => {
    if (zones.length > 0 && selectedZones.length === 0) {
      setSelectedZones(zones.map(z => z.id));
    }
  }, [zones]);

  const { resolvedTheme, theme } = useTheme();
  const mapTheme = (resolvedTheme ?? theme) === "dark" ? "dark" : "light";
  const tileUrl = mapTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution = mapTheme === "dark"
    ? "&copy; OpenStreetMap contributors &copy; CARTO"
    : "&copy; OpenStreetMap contributors";

  const filteredOrders = useMemo(() => {
    if (!orderLocations) return [];
    return orderLocations.filter(o => !o.pickup_zone || selectedZones.includes(o.pickup_zone));
  }, [orderLocations, selectedZones]);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, offered: 0, assigned: 0, picked_up: 0 };
    filteredOrders.forEach(o => {
      if (counts.hasOwnProperty(o.status)) {
        counts[o.status]++;
      }
    });
    return counts;
  }, [filteredOrders]);

  const toggleZone = (zoneId) => {
    setSelectedZones(prev => prev.includes(zoneId)
      ? prev.filter(z => z !== zoneId)
      : [...prev, zoneId]);
  };

  const toggleStatus = (status) => {
    setVisibleStatuses(prev => prev.includes(status)
      ? prev.filter(s => s !== status)
      : [...prev, status]);
  };

  return (<Card className="overflow-hidden">
    <CardHeader className="pb-3 border-b">
      <div className="flex items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2 font-bold">
          <MapPin className="w-5 h-5 text-destructive animate-pulse" />
          Live Fleet Distribution
        </CardTitle>
        <div className="flex items-center gap-3">
          {/* Status Legend */}
          <div className="flex gap-2 text-xs bg-muted/50 p-1 rounded-lg">
            {Object.keys(statusCounts).map(status => (
              <button key={status} onClick={() => toggleStatus(status)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${visibleStatuses.includes(status) ? "bg-background shadow-sm ring-1 ring-border" : "opacity-40 hover:opacity-60"}`}>
                <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: statusColors[status] }} />
                <div className="flex flex-col items-start leading-none gap-0.5">
                  <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">{status.replace('_', ' ')}</span>
                  <span className="text-xs font-black">{statusCounts[status]}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Zone Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 font-medium">
                <Filter className="h-3.5 w-3.5" />
                Zones ({selectedZones.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold">Filter Active Zones</span>
                <div className="flex gap-3">
                  <button onClick={() => setSelectedZones(zones.map(z => z.id))} className="text-xs text-primary font-bold hover:underline">Select All</button>
                  <button onClick={() => setSelectedZones([])} className="text-xs text-muted-foreground font-medium hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {zones.map((zone) => (<label key={zone.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs transition-colors ${selectedZones.includes(zone.id) ? "bg-accent" : "hover:bg-muted"}`}>
                  <Checkbox checked={selectedZones.includes(zone.id)} onCheckedChange={() => toggleZone(zone.id)} />
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: zone.color }} />
                  <span className="truncate flex-1 font-medium">{zone.name || zone.id}</span>
                  <span className="text-muted-foreground font-bold">{zone.pending}</span>
                </label>))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </CardHeader>

    <CardContent className="p-0">
      <div className="h-[460px] w-full relative">
        {(allocationLoading || ordersLoading) && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="text-xs font-medium text-muted-foreground">Loading Map Data...</span>
            </div>
          </div>
        )}
        <MapContainer center={[25.1500, 55.2500]} zoom={11} scrollWheelZoom={true} className="h-full w-full z-0" style={{ background: "hsl(var(--muted))" }} maxBounds={[[24.85, 54.9], [25.45, 55.6]]} minZoom={10}>
          <TileLayer key={mapTheme} attribution={tileAttribution} url={tileUrl} />

          <ClusterLayer orders={filteredOrders} visibleStatuses={visibleStatuses} />

          {zones.filter(z => selectedZones.includes(z.id)).map((zone) => {
            const sampleInZone = filteredOrders.find(o => o.pickup_zone === zone.id);
            const pos = sampleInZone ? [sampleInZone.pickup_latitude, sampleInZone.pickup_longitude] : [zone.lat, zone.lng];

            return (
              <Marker key={zone.id} position={pos} icon={createZoneIcon(zone.color, zone.pending)}>
                <Popup>
                  <div className="text-sm p-1">
                    <p className="font-bold border-b pb-1 mb-1">{zone.name || 'Zone ' + zone.id}</p>
                    <div className="space-y-1 mt-1">
                      <p className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Pending:</span>
                        <span className="font-bold text-primary">{zone.pending} orders</span>
                      </p>
                      <p className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Drivers:</span>
                        <span className="font-bold">{zone.drivers}</span>
                      </p>
                      <p className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Pressure:</span>
                        <span className={`font-bold ${zone.pressure > 2 ? 'text-destructive' : 'text-success'}`}>{zone.pressure}x</span>
                      </p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {driverLocations?.map(driver => (
            <Marker key={driver.driver_id} position={[driver.latitude, driver.longitude]} icon={L.divIcon({
              className: 'driver-marker',
              html: `<div style="background-color: #3b82f6; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid white; box-shadow: 0 0 5px rgba(59,130,246,0.5);"></div>`,
              iconSize: [8, 8]
            })}>
              <Popup>
                <div className="text-xs font-bold">
                  {driver.name}
                </div>
              </Popup>
            </Marker>
          ))}

          <MapControls />

          {/* Map Legend */}
          <div className="absolute left-3 bottom-8 z-[1000] bg-background/90 backdrop-blur-sm p-2 rounded-lg shadow-lg border border-border text-[10px] space-y-1.5 min-w-[120px]">
            <p className="font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50 pb-1 mb-1.5">Map Legend</p>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-primary border border-white shadow-sm" />
              <span className="font-medium">Active Driver</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-primary border border-white flex items-center justify-center text-white scale-75">3</div>
              <span className="font-medium">Order Cluster</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow-md" style={{ backgroundColor: '#ef4444' }} />
              <span className="font-medium">Zone Center (Pending Counts)</span>
            </div>
            <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/50 italic">Clusters expand when zoomed in</p>
          </div>
        </MapContainer>
      </div>
    </CardContent>
  </Card>);
}

