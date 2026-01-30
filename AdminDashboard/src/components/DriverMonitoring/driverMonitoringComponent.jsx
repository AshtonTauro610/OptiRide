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
import { useDrivers, usePolling, useDriverPerformanceStats } from "@/utils/hooks/use-api";


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
  // Mapping scores (0-10) or text levels to UI classes
  if (score >= 8 || score === "SEVERE") return "bg-destructive/10 text-destructive";
  if (score >= 5 || score === "WARNING") return "bg-warning/10 text-warning";
  if (score >= 2 || score === "MILD") return "bg-primary/10 text-primary";
  return "bg-success/10 text-success";
};
const formatLastActive = (dateString) => {
  if (!dateString) return "Offline";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return "Just Now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
};
export function DriverMonitoring() {
  const [chatTarget, setChatTarget] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all-status");
  const [page, setPage] = useState(0);
  const limit = 20;
  // Fetch drivers from API
  const { data: driversData, refetch } = useDrivers(page * limit, limit);

  usePolling(refetch, 10000);

  // Fetch performance stats for selected driver
  const { data: driverStats } = useDriverPerformanceStats(selectedDriver?.driver_id);
  const drivers = driversData?.drivers || [];
  const totalDrivers = driversData?.total || 0;
  const filteredDrivers = drivers.filter((driver) => {
    const matchesSearch = driver.vehicle_plate?.toLowerCase().includes(searchQuery.toLowerCase()) ||
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
      </div>
    </div>

    {/* Filters */}
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by ID, plate, or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
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
              <TableHead>Safety Score</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDrivers.map((driver) => (<TableRow key={driver.driver_id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${driver.fatigue === 'SEVERE' ? 'bg-destructive/20 text-destructive' :
                    driver.fatigue === 'WARNING' ? 'bg-warning/20 text-warning' :
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
                <Badge className={`${getFatigueColor(driver.fatigue_score)} border-0`}>
                  {driver.fatigue_score > 7 ? 'SEVERE' : driver.fatigue_score > 4 ? 'WARNING' : 'NORMAL'}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {driver.current_speed ? `${driver.current_speed.toFixed(1)} km/h` : '0 km/h'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatLastActive(driver.updated_at)}
              </TableCell>
              <TableCell>
                <span className={`font-medium ${(driver.safety_score || 100) >= 80 ? 'text-success' :
                    (driver.safety_score || 100) >= 50 ? 'text-warning' : 'text-destructive'
                  }`}>
                  {driver.safety_score || 100}/100
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

    <DriverChatDialog open={isChatOpen} onOpenChange={setIsChatOpen} target={chatTarget} />

    {/* Driver Detail Modal */}
    <Dialog open={selectedDriver !== null} onOpenChange={() => setSelectedDriver(null)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Driver Profile: {selectedDriver?.name}</DialogTitle>
          <DialogDescription>Real-time monitoring and safety insights</DialogDescription>
        </DialogHeader>

        {selectedDriver && (<div className="space-y-6">
          {/* Driver Info Header */}
          <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
            <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl">
              {selectedDriver.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1">
              <h3 className="text-foreground">{selectedDriver.name}</h3>
              <p className="text-muted-foreground">{selectedDriver.driver_id}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge className={`${getStatusColor(selectedDriver.status)} border-0`}>
                  {selectedDriver.status}
                </Badge>
                <Badge className={`${getFatigueColor(selectedDriver.fatigue_score)} border-0`}>
                  {selectedDriver.fatigue_score > 7 ? 'SEVERE' : selectedDriver.fatigue_score > 4 ? 'WARNING' : 'NORMAL'}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <div className="text-foreground">Safety Score</div>
              <div className="text-3xl text-green-600">
                {driverStats?.average_rating ? (driverStats.average_rating * 20).toFixed(0) : "95"}
              </div>
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
                <MapPin className="w-12 h-12 text-blue-600 mx-auto mb-2" />
                <p className="text-muted-foreground">Current Location: {selectedDriver.current_zone || "N/A"}</p>
                <p className="text-muted-foreground">Speed: 0 km/h {/* Hardcoded: Speed Data */}</p>
              </div>
            </div>
          </Card>

          {/* Operational Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-blue-600" />
                <span className="text-muted-foreground">Orders Today</span>
              </div>
              <p className="text-foreground text-2xl">{driverStats?.today_orders ?? 0}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <span className="text-muted-foreground">Acceptance Rate</span>
              </div>
              <p className="text-foreground text-2xl">{driverStats?.completion_rate ?? 0}%</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-600" />
                <span className="text-muted-foreground">Breaks Taken</span>
              </div>
              <p className="text-foreground text-2xl">{driverStats?.today_breaks ?? 0}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Navigation className="w-4 h-4 text-purple-600" />
                <span className="text-muted-foreground">Distance</span>
              </div>
              <p className="text-foreground text-2xl">{driverStats?.today_distance ?? 0} km</p>
            </Card>
          </div>

          {/* Device Status */}
          <Card className="p-4">
            <h4 className="text-foreground mb-4">Device Status</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <Battery className={`w-5 h-5 ${(selectedDriver.battery_level ?? 100) > 50 ? "text-green-600" :
                    (selectedDriver.battery_level ?? 100) > 20 ? "text-yellow-600" : "text-red-600"
                  }`} />
                <div>
                  <p className="text-muted-foreground">Battery</p>
                  <p className="text-foreground">{selectedDriver.battery_level ?? 100}%</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Wifi className={`w-5 h-5 ${selectedDriver.network_strength === 'Strong' ? "text-green-600" :
                    selectedDriver.network_strength === 'Weak' ? "text-yellow-600" : "text-gray-400"
                  }`} />
                <div>
                  <p className="text-muted-foreground">Network</p>
                  <p className="text-foreground">{selectedDriver.network_strength ?? 'Unknown'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Camera className={`w-5 h-5 ${selectedDriver.camera_active ? "text-green-600" : "text-red-600"}`} />
                <div>
                  <p className="text-muted-foreground">Camera</p>
                  <p className="text-foreground">{selectedDriver.camera_active ? "Active" : "Inactive"}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* AI Recommendations */}
          <Card className="p-4 bg-blue-500/10 border-blue-500/20">
            <h4 className="text-foreground mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              AI-Generated Recommendations
            </h4>
            <div className="space-y-2">
              {selectedDriver.fatigue_score > 7 && (<div className="p-3 bg-card rounded border border-red-500/20">
                <p className="text-red-700">⚠️ Driver has shown critical fatigue levels. Recommend immediate 20-minute break.</p>
              </div>)}
              {selectedDriver.fatigue_score > 4 && selectedDriver.fatigue_score <= 7 && (<div className="p-3 bg-card rounded border border-orange-500/20">
                <p className="text-orange-700">⚠️ Driver has shown increased fatigue in the past hour. Recommend a 10-minute break.</p>
              </div>)}
              {(selectedDriver.battery_level ?? 100) < 40 && (<div className="p-3 bg-card rounded border border-yellow-500/20">
                <p className="text-yellow-700">🔋 Low battery detected. Suggest driver charges device during next break.</p>
              </div>)}
              {!selectedDriver.camera_active && (<div className="p-3 bg-card rounded border border-red-500/20">
                <p className="text-red-700">📷 Camera is inactive. Safety monitoring may be compromised.</p>
              </div>)}
              {selectedDriver.idleTime?.includes("hr") && (<div className="p-3 bg-card rounded border border-blue-500/20">
                <p className="text-blue-700">💡 Driver is consistently staying in low-demand areas. Suggest relocating to Zone A3.</p>
              </div>)}
            </div>
          </Card>

          {/* Safety History */}
          <Card className="p-4">
            <h4 className="text-foreground mb-4">Safety History (Today)</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-muted rounded">
                <span className="text-muted-foreground">Safety Alerts</span>
                <Badge variant="secondary">{driverStats?.today_safety_alerts ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded">
                <span className="text-muted-foreground">Fatigue Score (Avg)</span>
                <Badge variant="secondary">{driverStats?.average_fatigue_score?.toFixed(1) ?? "0.0"}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded">
                <span className="text-muted-foreground">Total Orders (Lifetime)</span>
                <Badge variant="secondary">{driverStats?.total_orders ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded">
                <span className="text-muted-foreground">Average Rating</span>
                <Badge variant="secondary">{driverStats?.average_rating?.toFixed(1) ?? "0.0"}/5.0</Badge>
              </div>
            </div>
          </Card>
        </div>)}
      </DialogContent>
    </Dialog>
  </div>);
}

