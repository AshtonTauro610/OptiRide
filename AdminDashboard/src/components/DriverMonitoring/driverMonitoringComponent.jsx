import { useState } from "react";
import { Search, Eye, MessageSquare, MapPin, Navigation, Package, TrendingUp, Clock, Battery, Wifi, Camera, Activity, } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { DriverChatDialog } from "@/components/shared/DriverChatDialog";
import { useDrivers, usePolling, useDriverPerformanceStats, useReallocateDriver, useAllocationStatus, useManualAllocate, useInitialAllocation, useDriverInsights } from "@/utils/hooks/use-api";
import { toast } from "sonner";


const getStatusColor = (status) => {
  const s = status?.toUpperCase();
  switch (s) {
    case "BUSY":
    case "ON_DELIVERY":
    case "ON DELIVERY":
      return "bg-primary/10 text-primary";
    case "AVAILABLE":
    case "ONLINE":
      return "bg-success/10 text-success";
    case "ON_BREAK":
    case "BREAK":
      return "bg-warning/10 text-warning";
    case "OFFLINE":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
};
const getFatigueColor = (score) => {
  // Mapping scores (0-100) or text levels to UI classes
  if (score >= 80 || score === "SEVERE") return "bg-destructive/10 text-destructive";
  if (score >= 65 || score === "WARNING") return "bg-warning/10 text-warning";
  if (score >= 30 || score === "MILD") return "bg-primary/10 text-primary";
  return "bg-success/10 text-success";
};
const formatLastActive = (dateString) => {
  if (!dateString) return "Offline";
  const date = new Date(dateString.endsWith('Z') ? dateString : `${dateString}Z`);
  const now = new Date();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (date < startOfToday) {
    const diffInMs = startOfToday - date;
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24)) + 1;
    return `${diffInDays}d ago`;
  }

  const diffInSeconds = Math.floor((now - date) / 1000);
  if (diffInSeconds < 60) return "Just Now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
export function DriverMonitoring() {
  const [chatTarget, setChatTarget] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all-status");
  const [page, setPage] = useState(0);
  const limit = 15;
  const [selectedManualZone, setSelectedManualZone] = useState("");

  const { data: driversData, refetch } = useDrivers(0, 500);

  usePolling(refetch, 10000);

  // Fetch performance stats for selected driver
  const { data: driverStats } = useDriverPerformanceStats(selectedDriver?.driver_id);
  const { reallocate, loading: isReallocating } = useReallocateDriver();
  const { data: allocationData } = useAllocationStatus();
  const { manualAllocate, loading: isManualAllocating } = useManualAllocate();
  const { initialAllocation, loading: isInitialAllocating } = useInitialAllocation();
  const { data: aiInsights, loading: isAiLoading } = useDriverInsights(selectedDriver?.driver_id);

  const handleInitialAllocation = async () => {
    try {
      await initialAllocation();
      toast.success("Fleet distribution optimized successfully");
      refetch(); // Refresh driver list
    } catch (err) {
      toast.error("Optimization failed: " + err.message);
    }
  };

  const handleReallocate = async (driverId) => {
    try {
      await reallocate(driverId);
      toast.success("Driver reallocated successfully");
      refetch(); // Refresh driver list
    } catch (err) {
      toast.error("Failed to reallocate driver: " + err.message);
    }
  };

  const handleManualAllocate = async (driverId) => {
    if (!selectedManualZone) {
      toast.error("Please select a zone");
      return;
    }
    try {
      await manualAllocate(driverId, selectedManualZone);
      toast.success(`Driver allocated to ${selectedManualZone}`);
      refetch();
      setSelectedManualZone("");
    } catch (err) {
      toast.error("Allocation failed: " + err.message);
    }
  };

  const zones = allocationData?.zones || [];
  const selectedZoneData = zones.find(z => z.zone_id === selectedManualZone);

  const drivers = driversData?.drivers || [];
  const totalDrivers = driversData?.total || 0;
  const filteredDrivers = drivers.filter((driver) => {
    const matchesSearch = driver.vehicle_plate?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.driver_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all-status" ||
      driver.status.toLowerCase() === statusFilter.toLowerCase().replace(" ", "_");
    return matchesSearch && matchesStatus;
  });
  const activeDeliveries = drivers.filter(d => d.status === "BUSY").length;
  return (<div className="p-6 space-y-6">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold">Driver Monitoring System</h1>
        <p className="text-muted-foreground">Real-time tracking and safety monitoring</p>
      </div>
      <div className="flex items-center gap-4">
        <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-0">
          {activeDeliveries} Active Deliveries
        </Badge>
        <Badge className="bg-success/10 text-success hover:bg-success/20 border-0">
          {totalDrivers} Total Drivers
        </Badge>
        <Button
          onClick={handleInitialAllocation}
          disabled={isInitialAllocating}
          variant="outline"
          className="border-primary text-primary hover:bg-primary/10 gap-2"
        >
          <TrendingUp className="w-4 h-4" />
          {isInitialAllocating ? "Optimizing..." : "Optimize Fleet Distribution"}
        </Button>
      </div>
    </div>

    {/* Filters */}
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name, ID, plate, or email..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }} className="pl-10" />
          </div>
          <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(0); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-status">All Statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="busy">Busy</SelectItem>
              <SelectItem value="on_break">On Break</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    {/* Drivers Table */}
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Fatigue Level</TableHead>
              <TableHead>Speed</TableHead>
              <TableHead>Last Activity</TableHead>
              <TableHead>Today's Score</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDrivers.slice(page * limit, (page + 1) * limit).map((driver) => (<TableRow key={driver.driver_id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${driver.fatigue_score >= 0.8 ? 'bg-destructive/20 text-destructive' :
                    driver.fatigue_score >= 0.65 ? 'bg-warning/20 text-warning' :
                      'bg-primary/20 text-primary'}`}>
                    {driver.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="font-medium">{driver.name}</p>
                    <p className="text-xs text-muted-foreground">{driver.driver_id}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge className={`${getStatusColor(driver.status)} border-0`}>
                  {driver.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {driver.current_zone || "N/A"}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={`${getFatigueColor(driver.fatigue_score ? driver.fatigue_score * 100 : 0)} border-0`}>
                  {driver.fatigue_score >= 0.8 ? 'SEVERE' : driver.fatigue_score >= 0.65 ? 'WARNING' : 'NORMAL'}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {driver.current_speed !== undefined && driver.current_speed !== null ? `${Math.max(0, Math.ceil(driver.current_speed))} km/h` : '0 km/h'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatLastActive(driver.updated_at)}
              </TableCell>
              <TableCell>
                <span className={`font-medium ${(driver.today_safety_score ?? 100) >= 80 ? 'text-success' :
                  (driver.today_safety_score ?? 100) >= 50 ? 'text-warning' : 'text-destructive'
                  }`}>
                  {(driver.today_safety_score ?? 100).toFixed(0)}/100
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSelectedDriver(driver)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                    setChatTarget({
                      driverId: driver.driver_id,
                      driverName: driver.name,
                      status: driver.status,
                      location: driver.current_zone,
                    });
                    setIsChatOpen(true);
                  }}>
                    <MessageSquare className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    {/* Pagination controls */}
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">
        Showing Page {page + 1} of {Math.max(1, Math.ceil(filteredDrivers.length / limit))} ({filteredDrivers.length} Results)
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage(p => Math.max(0, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={(page + 1) * limit >= filteredDrivers.length}
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>

    <DriverChatDialog open={isChatOpen} onOpenChange={setIsChatOpen} target={chatTarget} />

    {/* Driver Detail Modal */}
    <Dialog open={selectedDriver !== null} onOpenChange={() => setSelectedDriver(null)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Driver Profile: {selectedDriver?.name}</DialogTitle>
          <DialogDescription>Real-time monitoring and safety insights</DialogDescription>
        </DialogHeader>

        {(() => {
          const currentDriver = drivers.find(d => d.driver_id === selectedDriver?.driver_id);
          if (!currentDriver) return null;

          return (<div className="space-y-6">
            {/* Driver Info Header */}
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl">
                {currentDriver.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1">
                <h3 className="text-foreground">{currentDriver.name}</h3>
                <p className="text-muted-foreground">{currentDriver.driver_id}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge className={`${getStatusColor(currentDriver.status)} border-0`}>
                    {currentDriver.status}
                  </Badge>
                  <Badge className={`${getFatigueColor(currentDriver.fatigue_score)} border-0`}>
                    {currentDriver.fatigue_score >= 0.8 ? 'SEVERE' : currentDriver.fatigue_score >= 0.65 ? 'WARNING' : 'NORMAL'}
                  </Badge>
                </div>
              </div>
              <div className="text-right flex flex-col items-end gap-2">
                <div>
                  <div className="text-foreground">Today's Safety Score</div>
                  <div className={`text-3xl font-bold ${(driverStats?.today_safety_score ?? 100) >= 80 ? 'text-success' :
                    (driverStats?.today_safety_score ?? 100) >= 50 ? 'text-warning' : 'text-destructive'
                    }`}>
                    {driverStats?.today_safety_score?.toFixed(0) ?? "100"}/100
                  </div>
                </div>
                <Button
                  onClick={() => handleReallocate(currentDriver.driver_id)}
                  disabled={isReallocating}
                  size="sm"
                  className="gap-2"
                >
                  <TrendingUp className="w-4 h-4" />
                  {isReallocating ? "Reallocating..." : "Reallocate Now"}
                </Button>
              </div>
            </div>

            {/* Live Map Tracking */}
            <Card className="p-4">
              <h4 className="text-foreground mb-4 flex items-center gap-2">
                <Navigation className="w-4 h-4" />
                Live GPS Tracking
              </h4>
              <div className="h-48 bg-muted rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-12 h-12 text-primary mx-auto mb-2" />
                  <p className="text-muted-foreground">Current Location: {currentDriver.current_zone || "N/A"}</p>
                  <p className="text-muted-foreground">Speed: {currentDriver.current_speed !== undefined ? Math.max(0, Math.ceil(currentDriver.current_speed)) : 0} km/h</p>
                </div>
              </div>
            </Card>

            {/* Operational Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-primary" />
                  <span className="text-muted-foreground">Orders Today</span>
                </div>
                <p className="text-foreground text-2xl">{driverStats?.today_orders ?? 0}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-success" />
                  <span className="text-muted-foreground">Acceptance Rate</span>
                </div>
                <p className="text-foreground text-2xl">{driverStats?.completion_rate ?? 0}%</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-warning" />
                  <span className="text-muted-foreground">Breaks Taken</span>
                </div>
                <p className="text-foreground text-2xl">{driverStats?.today_breaks ?? 0}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Navigation className="w-4 h-4 text-primary" />
                  <span className="text-muted-foreground">Distance</span>
                </div>
                <p className="text-foreground text-2xl">{driverStats?.today_distance ?? 0} km</p>
              </Card>
            </div>

            {/* Selective Allocation Control */}
            <Card className="p-4 border-primary/20 bg-primary/5">
              <h4 className="text-foreground mb-4 flex items-center gap-2 font-semibold">
                <MapPin className="w-4 h-4 text-primary" />
                Selective Zone Allocation
              </h4>
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Target Zone Selection</p>
                  <Select value={selectedManualZone} onValueChange={setSelectedManualZone}>
                    <SelectTrigger className="w-full bg-background border-primary/20">
                      <SelectValue placeholder="Select target zone..." />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((z) => (
                        <SelectItem key={z.zone_id} value={z.zone_id}>
                          {z.zone_name} ({z.zone_id}) - Pressure: {z.demand_pressure}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => handleManualAllocate(selectedDriver.driver_id)}
                  disabled={isManualAllocating || !selectedManualZone}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[140px]"
                >
                  {isManualAllocating ? "Allocating..." : "Confirm Allocation"}
                </Button>
              </div>

              {selectedZoneData && (
                <div className="mt-4 grid grid-cols-3 gap-2 p-3 bg-background/50 rounded-md border border-primary/10">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Demand Score</p>
                    <p className="font-bold text-primary">{selectedZoneData.demand_score}</p>
                  </div>
                  <div className="text-center border-x border-primary/10">
                    <p className="text-[10px] text-muted-foreground uppercase">Current Drivers</p>
                    <p className="font-bold text-foreground">{selectedZoneData.total_drivers}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Pressure</p>
                    <p className={`font-bold ${selectedZoneData.demand_pressure > 2 ? 'text-destructive' : selectedZoneData.demand_pressure > 1 ? 'text-warning' : 'text-success'}`}>
                      {selectedZoneData.demand_pressure}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            {/* Device Status */}
            <Card className="p-4">
              <h4 className="text-foreground mb-4">Device Status</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <Battery className={`w-5 h-5 ${(selectedDriver.battery_level ?? 100) > 50 ? "text-success" :
                    (selectedDriver.battery_level ?? 100) > 20 ? "text-warning" : "text-destructive"
                    }`} />
                  <div>
                    <p className="text-muted-foreground">Battery</p>
                    <p className="text-foreground">{selectedDriver.battery_level ?? 100}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Wifi className={`w-5 h-5 ${selectedDriver.network_strength === 'Strong' ? "text-success" :
                    selectedDriver.network_strength === 'Weak' ? "text-warning" : "text-muted-foreground"
                    }`} />
                  <div>
                    <p className="text-muted-foreground">Network</p>
                    <p className="text-foreground">{selectedDriver.network_strength ?? 'Unknown'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Camera className={`w-5 h-5 ${selectedDriver.camera_active ? "text-success" : "text-destructive"}`} />
                  <div>
                    <p className="text-muted-foreground">Camera</p>
                    <p className="text-foreground">{selectedDriver.camera_active ? "Active" : "Inactive"}</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-primary/10 border-primary/20">
              <h4 className="text-foreground mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                AI-Generated Recommendations
              </h4>
              <div className="space-y-2">
                {isAiLoading ? (
                  <p className="text-xs text-muted-foreground animate-pulse">Consulting GenAI advisor...</p>
                ) : aiInsights?.insights && aiInsights.insights.length > 0 ? (
                  aiInsights.insights.map((insight, idx) => (
                    <div key={idx} className="p-3 bg-card rounded border border-primary/20">
                      <p className="text-primary text-sm flex items-start gap-2">
                        <span className="mt-1">💡</span>
                        {insight}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-3 bg-card rounded border border-muted">
                    <p className="text-muted-foreground text-sm">No critical performance issues detected by AI.</p>
                  </div>
                )}

              </div>
            </Card>

            {/* Safety History */}
            <Card className="p-4">
              <h4 className="text-foreground mb-4">Safety & Performance Metrics</h4>
              <div className="space-y-2">
                {/* Today's Stats - Primary */}
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Today's Safety Score</span>
                  <Badge className={`${(driverStats?.today_safety_score ?? 100) >= 80 ? 'bg-success/10 text-success' :
                    (driverStats?.today_safety_score ?? 100) >= 50 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
                    }`}>
                    {driverStats?.today_safety_score?.toFixed(0) ?? "100"}/100
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Today's Safety Alerts</span>
                  <Badge className={driverStats?.today_safety_alerts > 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}>
                    {driverStats?.today_safety_alerts ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Current Fatigue Level</span>
                  <Badge className={`${getFatigueColor((driverStats?.current_fatigue_score ?? 0) * 100)} border-0`}>
                    {((driverStats?.current_fatigue_score ?? 0) * 100).toFixed(0)}/100
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Today's Harsh Braking</span>
                  <Badge className={driverStats?.today_harsh_braking > 3 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}>
                    {driverStats?.today_harsh_braking ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Today's Speeding Events</span>
                  <Badge className={driverStats?.today_speeding > 2 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}>
                    {driverStats?.today_speeding ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Today's Fatigue Alerts</span>
                  <Badge className={driverStats?.today_fatigue_alerts > 1 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}>
                    {driverStats?.today_fatigue_alerts ?? 0}
                  </Badge>
                </div>

                {/* 30-Day Averages - Secondary */}
                <div className="pt-2 mt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">30-Day Averages</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Avg Safety Score (30d)</span>
                  <Badge className={`${(driverStats?.avg_30d_safety_score ?? 100) >= 80 ? 'bg-success/10 text-success' :
                    (driverStats?.avg_30d_safety_score ?? 100) >= 50 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
                    }`}>
                    {driverStats?.avg_30d_safety_score?.toFixed(0) ?? "100"}/100
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Total Alerts (30d)</span>
                  <Badge variant="secondary">{driverStats?.total_30d_alerts ?? 0}</Badge>
                </div>

                {/* Lifetime Stats */}
                <div className="pt-2 mt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Lifetime Stats</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Total Orders</span>
                  <Badge variant="secondary">{driverStats?.total_orders ?? 0}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Average Rating</span>
                  <Badge variant="secondary">{driverStats?.average_rating?.toFixed(1) ?? "0.0"}/5.0</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded">
                  <span className="text-muted-foreground">Completion Rate</span>
                  <Badge className={driverStats?.completion_rate >= 90 ? 'bg-success/10 text-success' : driverStats?.completion_rate >= 15 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}>
                    {driverStats?.completion_rate?.toFixed(1) ?? "0"}%
                  </Badge>
                </div>
              </div>
            </Card>
          </div>);
        })()}
      </DialogContent>
    </Dialog>
  </div>);
}

