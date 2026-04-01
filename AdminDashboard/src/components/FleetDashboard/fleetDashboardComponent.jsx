import { Users, AlertTriangle, Package, UserX, CheckCircle, Clock, TrendingUp, TrendingDown, Activity, DollarSign } from "lucide-react";
import { MetricCard } from "@/components/shared/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HighDemandMap } from "@/components/shared/HighDemandMap";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";
import {
  useFleetDashboardCharts,
  useDashboardOverview,
  useDriversSummary,
  useRealtimeMetrics,
  usePolling
} from "@/utils/hooks/use-api";

export function FleetDashboard() {
  // Analytics service hooks
  const { data: dashboardCharts, refetch: refetchCharts } = useFleetDashboardCharts();
  const { data: dashboardOverview, refetch: refetchOverview } = useDashboardOverview('today');
  const { data: realtimeMetrics, refetch: refetchRealtime } = useRealtimeMetrics();
  const { data: driversSummary, refetch: refetchDrivers } = useDriversSummary();

  // Poll for real-time updates
  usePolling(() => {
    refetchCharts();
    refetchOverview();
    refetchRealtime();
    refetchDrivers();
  }, 5000);

  // Extract chart data from analytics service
  const deliveriesData = dashboardCharts?.hourly_stats || [];
  const weeklyData = dashboardCharts?.weekly_stats?.map(item => ({
    day: item.day,
    deliveries: item.completed_orders || item.total_orders,
    efficiency: item.efficiency || 0
  })) || [];

  // Driver metrics from drivers summary
  const availableDrivers = realtimeMetrics?.drivers_available || 0;
  const busyDrivers = realtimeMetrics?.drivers_busy || 0;
  const onBreakDrivers = realtimeMetrics?.drivers_on_break || 0;
  const offlineDrivers = driversSummary?.offline_drivers || 0;
  const totalDrivers = driversSummary?.total_drivers || 0;
  const totalActiveDrivers = availableDrivers + busyDrivers;

  // Real-time metrics from analytics service
  const driversOnline = realtimeMetrics?.drivers_online || 0;
  const ordersPending = realtimeMetrics?.orders_pending || 0;
  const ordersInProgress = realtimeMetrics?.orders_in_progress || 0;
  const ordersCompletedToday = realtimeMetrics?.orders_completed_today || 0;
  const ordersPerHour = realtimeMetrics?.orders_per_hour || 0;
  const avgWaitTime = realtimeMetrics?.avg_wait_time_min || 0;
  const activeAlerts = realtimeMetrics?.active_alerts || 0;

  // Dashboard overview metrics (with trends)
  const totalRevenue = dashboardOverview?.total_revenue || 0;
  const avgDeliveryTime = dashboardOverview?.avg_delivery_time_min || 0;
  const driverUtilizationRate = dashboardOverview?.driver_utilization_rate || 0;
  const orderCompletionRate = dashboardOverview?.order_completion_rate || 0;

  // Trend percentages from dashboard overview
  const ordersChangePct = dashboardOverview?.orders_change_percent || 0;
  const revenueChangePct = dashboardOverview?.revenue_change_percent || 0;
  const driversChangePct = dashboardOverview?.drivers_change_percent || 0;
  const completionRateChangePct = dashboardOverview?.completion_rate_change_percent || 0;
  const deliveryTimeChangePct = dashboardOverview?.delivery_time_change_percent || 0;

  // Map driver status for the distribution card
  const driverStatusData = [
    { label: "Active/Busy", value: busyDrivers, color: "bg-primary" },
    { label: "Available", value: availableDrivers, color: "bg-success" },
    { label: "On Break", value: onBreakDrivers, color: "bg-warning" },
    { label: "Offline", value: offlineDrivers, color: "bg-muted-foreground" },
  ].map(item => ({
    ...item,
    percentage: totalDrivers > 0 ? ((item.value / totalDrivers) * 100).toFixed(1) : 0
  }));

  // Helper function to format trend - cap extreme values for display
  const getTrend = (val) => {
    // Cap at ±200% for display purposes
    const cappedVal = Math.max(-200, Math.min(200, val || 0));
    const isPositive = cappedVal >= 0;
    const sign = isPositive ? "+" : "-";
    return {
      value: `${sign}${Math.abs(cappedVal).toFixed(1)}%`,
      isPositive: isPositive
    };
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fleet Dashboard</h1>
          <p className="text-muted-foreground">Monitor your fleet operations in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          {activeAlerts > 0 && (
            <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-0">
              {activeAlerts} Active Alerts
            </Badge>
          )}
          <Badge className="bg-success/10 text-success hover:bg-success/20 border-0">
            All Systems Operational
          </Badge>
        </div>
      </div>

      {/* Top Metrics - Real-time data */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title="Drivers Online"
          value={driversOnline.toString()}
          subtitle={`${totalActiveDrivers} actively working`}
          icon={Users}
          iconColor="text-success"
        />
        <MetricCard
          title="Pending Orders"
          value={ordersPending.toString()}
          subtitle={`Avg wait: ${avgWaitTime.toFixed(1)} min`}
          icon={AlertTriangle}
          iconColor="text-destructive"
        />
        <MetricCard
          title="In Progress"
          value={ordersInProgress.toString()}
          subtitle={`${ordersPerHour.toFixed(1)} orders/hour`}
          icon={Package}
          iconColor="text-primary"
        />
        <MetricCard
          title="Available Drivers"
          value={availableDrivers.toString()}
          subtitle="Ready for assignment"
          icon={UserX}
          iconColor="text-muted-foreground"
        />
      </div>

      {/* Second Row Metrics - Dashboard overview with trends */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title="Completed Today"
          value={ordersCompletedToday.toLocaleString()}
          subtitle={`${orderCompletionRate.toFixed(1)}% completion rate`}
          icon={CheckCircle}
          trend={getTrend(ordersChangePct)}
          iconColor={ordersChangePct >= 0 ? "text-success" : "text-destructive"}
        />
        <MetricCard
          title="Total Revenue"
          value={`AED ${totalRevenue.toLocaleString()}`}
          subtitle="Today's earnings"
          icon={revenueChangePct >= 0 ? TrendingUp : TrendingDown}
          trend={getTrend(revenueChangePct)}
          iconColor={revenueChangePct >= 0 ? "text-success" : "text-destructive"}
        />
        <MetricCard
          title="Avg Delivery Time"
          value={`${avgDeliveryTime.toFixed(1)} min`}
          subtitle="Per order"
          icon={Clock}
          iconColor="text-primary"
        />
        <MetricCard
          title="Fleet Utilization"
          value={`${driverUtilizationRate.toFixed(1)}%`}
          subtitle="Driver efficiency"
          icon={Activity}
          trend={getTrend(driversChangePct)}
          iconColor="text-success"
        />
      </div>

      {/* High Demand Zones Map */}
      <HighDemandMap />

      {/* Charts and Stats Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Deliveries Today Chart */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Deliveries Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={deliveriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} />
                  <Area type="monotone" dataKey="completed" stackId="1" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.3)" name="Completed" />
                  <Area type="monotone" dataKey="cancelled" stackId="1" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.3)" name="Cancelled" />
                  <Area type="monotone" dataKey="ongoing" stackId="1" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.3)" name="Ongoing" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-success" />
                <span className="text-xs text-muted-foreground">Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-destructive" />
                <span className="text-xs text-muted-foreground">Cancelled</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground">Ongoing</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Driver Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Driver Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {driverStatusData.map((status) => (
              <div key={status.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{status.label}</span>
                  <span className="font-medium">{status.value} ({status.percentage}%)</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${status.color}`}
                    style={{ width: `${status.percentage}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Fleet</span>
                <span className="font-medium">{totalDrivers} drivers</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-muted-foreground">Utilization</span>
                <span className="font-medium text-success">{driverUtilizationRate.toFixed(1)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly Performance and Real-time Stats */}
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Weekly Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} />
                  <Line yAxisId="left" type="monotone" dataKey="efficiency" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))' }} name="Efficiency %" />
                  <Line yAxisId="right" type="monotone" dataKey="deliveries" stroke="hsl(var(--success))" strokeWidth={2} dot={{ fill: 'hsl(var(--success))' }} name="Total Deliveries" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground">Efficiency %</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-success" />
                <span className="text-xs text-muted-foreground">Total Deliveries</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Real-time Metrics Summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Real-time Metrics</CardTitle>
            <span className="text-xs text-success animate-pulse">● live</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Orders/Hour</span>
              <span className="font-semibold">{ordersPerHour.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Avg Wait Time</span>
              <span className="font-semibold">{avgWaitTime.toFixed(1)} min</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Drivers Available</span>
              <span className="font-semibold text-success">{realtimeMetrics?.drivers_available || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Drivers Busy</span>
              <span className="font-semibold text-primary">{realtimeMetrics?.drivers_busy || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">On Break</span>
              <span className="font-semibold text-warning">{realtimeMetrics?.drivers_on_break || 0}</span>
            </div>
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Alerts</span>
                <span className={`font-semibold ${activeAlerts > 0 ? 'text-destructive' : 'text-success'}`}>
                  {activeAlerts}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
