import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Package, Clock, Users, MapPin, AlertTriangle, Activity, Zap, Brain, CloudRain, Target, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import {
  useDriversSummary,
  useDashboardOverview,
  useRealtimeMetrics,
  useFleetDashboardCharts,
  useSafetyAlerts,
  usePolling,
  useAlertsSummary,
  useSafetyScore,
  useTopPerformers,
  useDemandForecast,
  useDemandHistory,
  useZoneDemandHistory,
  usePredictiveRisks
} from "@/utils/hooks/use-api";

// Helper: format date to YYYY-MM-DD
const formatDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Get today in Dubai time (UTC+4)
const getTodayDubai = () => {
  const now = new Date();
  const dubaiOffset = 4 * 60; // minutes
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + dubaiOffset * 60000);
};

export function Analytics() {
  // Date navigation state for demand chart
  const [selectedDate, setSelectedDate] = useState(null); // null = today
  const [selectedZone, setSelectedZone] = useState(null); // null = show all zones grid
  // API Data - Dynamic from analytics service
  const { data: driversSummary, refetch: refetchDrivers } = useDriversSummary();
  const { data: dashboardOverview, refetch: refetchOverview } = useDashboardOverview('last_30_days');
  const { data: realtimeMetrics, refetch: refetchRealtime } = useRealtimeMetrics();
  const { data: fleetCharts, refetch: refetchCharts } = useFleetDashboardCharts();
  const { data: safetyAlerts, refetch: refetchAlerts } = useSafetyAlerts();

  // NEW: Backend-calculated aggregated analytics (using 30d for consistency)
  const { data: alertsSummary, refetch: refetchAlertsSummary } = useAlertsSummary('last_30_days');
  const { data: safetyScoreData, refetch: refetchSafetyScore } = useSafetyScore('last_30_days');
  const { data: topPerformers, refetch: refetchTopPerformers } = useTopPerformers('last_30_days', 5);
  const { data: demandForecast, refetch: refetchDemandForecast } = useDemandForecast(12);
  const { data: demandHistory, refetch: refetchDemandHistory } = useDemandHistory(selectedDate);
  const { data: zoneDemandHistory, refetch: refetchZoneDemandHistory } = useZoneDemandHistory(selectedDate);
  const { data: predictiveRisks, refetch: refetchRisks } = usePredictiveRisks();

  // Auto-refresh data every 10 seconds
  usePolling(() => {
    refetchDrivers();
    refetchOverview();
    refetchRealtime();
    refetchCharts();
    refetchAlerts();
    refetchAlertsSummary();
    refetchSafetyScore();
    refetchTopPerformers();
    refetchDemandForecast();
    refetchDemandHistory();
    refetchZoneDemandHistory();
    refetchRisks();
  }, 10000);

  // Date navigation helpers
  const goToPreviousDay = () => {
    const today = getTodayDubai();
    const current = selectedDate ? new Date(selectedDate + 'T00:00:00') : today;
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    // Don't go more than 30 days back
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    if (prev >= thirtyDaysAgo) {
      setSelectedDate(formatDateStr(prev));
    }
  };

  const goToNextDay = () => {
    if (!selectedDate) return; // already at today
    const current = new Date(selectedDate + 'T00:00:00');
    const next = new Date(current);
    next.setDate(next.getDate() + 1);
    const today = getTodayDubai();
    if (formatDateStr(next) >= formatDateStr(today)) {
      setSelectedDate(null); // back to today
    } else {
      setSelectedDate(formatDateStr(next));
    }
  };

  const goToToday = () => setSelectedDate(null);
  const isToday = selectedDate === null || selectedDate === formatDateStr(getTodayDubai());

  // ============================================
  // DYNAMIC DATA - From Analytics Service
  // ============================================

  // Dashboard Overview metrics (from /analytics/dashboard)
  const totalOrders = dashboardOverview?.total_orders || 0;
  const completedOrders = dashboardOverview?.completed_orders || 0;
  const totalRevenue = dashboardOverview?.total_revenue || 0;
  const avgDeliveryTimeFromOverview = dashboardOverview?.avg_delivery_time_min || 0;
  const orderCompletionRate = dashboardOverview?.order_completion_rate || 0;
  const driverUtilizationRate = dashboardOverview?.driver_utilization_rate || 0;
  const totalSafetyAlerts = dashboardOverview?.total_safety_alerts || 0;
  const criticalAlerts = dashboardOverview?.critical_alerts || 0;

  // Trend percentages (from /analytics/dashboard)
  const ordersChangePct = dashboardOverview?.orders_change_percent || 0;
  const revenueChangePct = dashboardOverview?.revenue_change_percent || 0;
  const driversChangePct = dashboardOverview?.drivers_change_percent || 0;
  const completionRateChangePct = dashboardOverview?.completion_rate_change_percent || 0;
  const deliveryTimeChangePct = dashboardOverview?.delivery_time_change_percent || 0;

  // Realtime metrics (from /analytics/realtime) - Only used for active alerts count
  const activeAlertsCount = realtimeMetrics?.active_alerts || 0;

  // Driver metrics (from /drivers/stats/summary)
  const totalDrivers = driversSummary?.total_drivers || 0;
  const activeDrivers = (driversSummary?.available_drivers || 0) + (driversSummary?.busy_drivers || 0);
  const utilization = driverUtilizationRate || (totalDrivers > 0 ? Math.round((activeDrivers / totalDrivers) * 100) : 0);

  // Delivery Trends - Dynamic from fleet charts (from /analytics/fleet-charts)
  const deliveryTrends = (fleetCharts?.hourly_stats || []).map(stat => ({
    time: stat.time,
    completed: stat.completed || 0,
    inTransit: stat.ongoing || 0,
    pending: stat.cancelled || 0
  }));

  // Weekly Performance - Dynamic from fleet charts
  const zonePerformance = (fleetCharts?.weekly_stats || []).map(stat => ({
    zone: stat.day,
    demand: stat.total_orders || 0,
    drivers: stat.completed_orders || 0,
    efficiency: stat.efficiency || 0
  }));

  // ============================================
  // NEW: Backend-calculated safety metrics
  // ============================================

  // Safety Score - Now from backend calculation
  const safetyScore = safetyScoreData?.overall_score || 0;
  const safetyGrade = safetyScoreData?.grade || 'N/A';
  const safetyTrend = safetyScoreData?.trend || 'stable';
  const safetyTrendPct = safetyScoreData?.trend_percentage || 0;
  const accidentRate = safetyScoreData?.accident_rate || 0;
  const totalIncidents = safetyScoreData?.total_incidents || alertsSummary?.total_alerts || 0;
  const fatigueAlertsCount = safetyScoreData?.fatigue_alerts_count || 0;
  const speedingEvents = safetyScoreData?.speeding_events || 0;
  const harshBrakingEvents = safetyScoreData?.harsh_braking_events || 0;

  // Alerts Summary - Now from backend aggregation
  const incidentTypes = alertsSummary?.by_type?.length > 0
    ? alertsSummary.by_type.map((item, index) => ({
      name: item.alert_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: item.count,
      color: ['#ef4444', '#f97316', '#eab308', '#dc2626', '#6366f1', '#22c55e'][index % 6]
    }))
    : [];

  // Alerts by day - Now from backend
  const fatigueData = alertsSummary?.by_day?.length > 0
    ? alertsSummary.by_day.map(item => ({
      day: item.day,
      alerts: item.count
    }))
    : [];

  // Incidents by zone - Now from backend
  const incidentByZone = alertsSummary?.by_zone?.length > 0
    ? alertsSummary.by_zone.map(item => ({
      zone: item.zone_name || item.zone_id,
      incidents: item.count
    }))
    : [];

  // Top Performers - Now from backend
  const driverEfficiency = topPerformers?.drivers?.length > 0
    ? topPerformers.drivers.map(driver => ({
      name: driver.name,
      score: driver.efficiency_score,
      orders: driver.orders_completed
    }))
    : [];

  // Demand history data (24h for selected date)
  const demandChartData = demandHistory?.data || [];
  const demandDateLabel = demandHistory?.date_label || 'Today';
  const currentHourIndex = demandHistory?.current_hour;
  const isDemandToday = demandHistory?.is_today ?? true;

  // Helper to format change percentages - cap extreme values for display
  const formatChange = (val) => {
    // Cap at ±200% for display purposes
    const cappedVal = Math.max(-200, Math.min(200, val || 0));
    const absVal = Math.abs(cappedVal).toFixed(1);
    return cappedVal >= 0 ? `+${absVal}%` : `-${absVal}%`;
  };

  // Check if we have meaningful comparison data
  const hasComparisonData = Math.abs(ordersChangePct) < 500;

  const StatCard = ({ title, value, change, icon: Icon, trend }) => {
    // If no change value is passed, fallback to a neutral badge
    const displayChange = change || "--";
    const displayTrend = change ? trend : "neutral";

    return (<Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${displayTrend === "up" ? "bg-green-100 dark:bg-green-900/20" : displayTrend === "down" ? "bg-red-100 dark:bg-red-900/20" : "bg-muted text-muted-foreground"}`}>
          <Icon className={`w-5 h-5 ${displayTrend === "up" ? "text-green-600 dark:text-green-400" : displayTrend === "down" ? "text-red-600 dark:text-red-400" : ""}`} />
        </div>
        <Badge className={displayTrend === "up" ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : displayTrend === "down" ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" : "bg-muted text-muted-foreground"}>
          {displayChange}
          {displayTrend === "up" && <TrendingUp className="w-3 h-3 ml-1 inline" />}
          {displayTrend === "down" && <TrendingDown className="w-3 h-3 ml-1 inline" />}
        </Badge>
      </div>
      <p className="text-muted-foreground mb-1">{title}</p>
      <p className="text-foreground text-3xl">{value}</p>
    </Card>)
  };
  return (<div className="space-y-6 p-6">
    {/* Header */}
    <div>
      <h2 className="text-foreground text-2xl font-semibold">Analytics Dashboard</h2>
      <p className="text-muted-foreground">Comprehensive fleet insights and predictive intelligence</p>
    </div>

    {/* Tabs */}
    <Tabs defaultValue="operational" className="space-y-6">
      <TabsList className="grid grid-cols-3 w-full max-w-2xl">
        <TabsTrigger value="operational">Operational Analytics</TabsTrigger>
        <TabsTrigger value="safety">Safety Analytics</TabsTrigger>
        <TabsTrigger value="predictive">Predictive AI</TabsTrigger>
      </TabsList>

      {/* Operational Analytics */}
      <TabsContent value="operational" className="space-y-6">
        {/* Key Metrics - Dynamic from analytics service */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            title="Avg Delivery Time (30d)"
            value={`${avgDeliveryTimeFromOverview.toFixed(1)} min`}
            change={formatChange(-deliveryTimeChangePct)}
            icon={Clock}
            trend={deliveryTimeChangePct <= 0 ? "up" : "down"}
          />
          <StatCard
            title="Total Orders (30d)"
            value={totalOrders}
            change={formatChange(ordersChangePct)}
            icon={Package}
            trend={ordersChangePct >= 0 ? "up" : "down"}
          />
          <StatCard
            title="Avg Utilization (30d)"
            value={`${driverUtilizationRate}%`}
            change={formatChange(driversChangePct)}
            icon={Users}
            trend={driversChangePct >= 0 ? "up" : "down"}
          />
          <StatCard
            title="Completion Rate (30d)"
            value={`${orderCompletionRate.toFixed(1)}%`}
            change={formatChange(completionRateChangePct)}
            icon={AlertTriangle}
            trend={completionRateChangePct >= 0 ? "up" : "down"}
          />
        </div>

        {/* Delivery Trends Chart - Dynamic from /analytics/fleet-charts */}
        <Card className="p-6">
          <h3 className="text-foreground mb-6">Order Fulfillment Trends (24 Hours)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={deliveryTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="completed" stackId="1" stroke="#22c55e" fill="#86efac" name="Completed" />
              <Area type="monotone" dataKey="inTransit" stackId="1" stroke="#3b82f6" fill="#93c5fd" name="In Transit" />
              <Area type="monotone" dataKey="pending" stackId="1" stroke="#eab308" fill="#fde047" name="Pending" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Zone Performance - Dynamic from /analytics/fleet-charts weekly_stats */}
        <Card className="p-6">
          <h3 className="text-foreground mb-6">Zone-Level Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={zonePerformance}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="zone" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="demand" fill="#3b82f6" name="Demand" />
              <Bar yAxisId="left" dataKey="drivers" fill="#22c55e" name="Drivers" />
              <Bar yAxisId="right" dataKey="efficiency" fill="#a855f7" name="Efficiency %" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Driver Efficiency Table - Dynamic from /analytics/drivers/top-performers */}
        <Card className="p-6">
          <h3 className="text-foreground mb-4">Top Performing Drivers</h3>
          <div className="space-y-3">
            {driverEfficiency.length > 0 ? driverEfficiency.map((driver, index) => (<div key={driver.name} className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                  {index + 1}
                </div>
                <div>
                  <p className="text-foreground">{driver.name}</p>
                  <p className="text-muted-foreground">{driver.orders} orders completed</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-muted-foreground">Efficiency Score</p>
                  <p className="text-foreground text-xl">{driver.score}/100</p>
                </div>
                <div className="w-24 h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600" style={{ width: `${driver.score}%` }} />
                </div>
              </div>
            </div>)) : (
              <p className="text-muted-foreground">No driver data available for the last 30 days.</p>
            )}
          </div>
        </Card>
      </TabsContent>

      {/* Safety Analytics */}
      <TabsContent value="safety" className="space-y-6">
        {/* Safety Metrics - Dynamic from backend safety score API */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            title="Total Incidents"
            value={totalIncidents}
            icon={AlertTriangle}
            trend="neutral"
          />
          <StatCard
            title="Active Alerts"
            value={activeAlertsCount}
            icon={Activity}
            trend={activeAlertsCount > 5 ? "down" : "neutral"}
          />
          <StatCard
            title="Fleet Safety Score"
            value={`${safetyScore.toFixed(0)}/100 (${safetyGrade})`}
            change={formatChange(safetyTrendPct)}
            icon={Target}
            trend={safetyTrendPct >= 0 ? "up" : "down"}
          />
          <StatCard
            title="Accident Rate"
            value={`${accidentRate}%`}
            icon={Zap}
            trend="neutral"
          />
        </div>

        {/* Fatigue Trend - Dynamic from /analytics/alerts/summary */}
        <Card className="p-6">
          <h3 className="text-foreground mb-6">Safety Alert Trends (Last 7 Days)</h3>
          {fatigueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={fatigueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="alerts" stroke="#ef4444" strokeWidth={3} name="Safety Alerts" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-10">No alerts recorded in this period.</p>
          )}
          {activeAlertsCount > 5 && (
            <div className="mt-4 p-4 bg-orange-500/10 dark:bg-orange-900/20 border border-orange-500/20 rounded-lg">
              <p className="text-orange-700 dark:text-orange-400">
                ⚠️ <strong>Alert:</strong> {activeAlertsCount} unacknowledged safety alerts require immediate attention.
              </p>
            </div>
          )}
        </Card>

        {/* Incident Types - Dynamic from /analytics/alerts/summary */}
        <div className="grid grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-foreground mb-6">Incident Distribution by Type</h3>
            {incidentTypes.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={incidentTypes} cx="50%" cy="50%" labelLine={false} label={(entry) => `${entry.name} ${(entry.percent * 100).toFixed(0)}%`} outerRadius={100} fill="#8884d8" dataKey="value">
                    {incidentTypes.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-10">No incident occurrences available for this period.</p>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="text-foreground mb-6">Incidents by Zone</h3>
            {incidentByZone.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={incidentByZone}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="zone" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="incidents" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-10">No incidents triggered per zone in this period.</p>
            )}
          </Card>
        </div>

        {/* Dangerous Behavior Metrics - Dynamic from backend safety score API */}
        <Card className="p-6">
          <h3 className="text-foreground mb-4">Dangerous Behavior Metrics</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-red-500/10 dark:bg-red-900/20 rounded-lg border border-red-500/20">
              <p className="text-muted-foreground mb-2">Harsh Braking</p>
              <p className="text-foreground text-2xl">{harshBrakingEvents} events</p>
              <p className="text-red-600 dark:text-red-400 mt-2">Severity Score: {safetyScoreData?.behavior_score?.toFixed(0) || 'N/A'}</p>
            </div>
            <div className="p-4 bg-orange-500/10 dark:bg-orange-900/20 rounded-lg border border-orange-500/20">
              <p className="text-muted-foreground mb-2">Speeding Events</p>
              <p className="text-foreground text-2xl">{speedingEvents} events</p>
              <p className="text-orange-600 dark:text-orange-400 mt-2">
                {safetyScoreData?.peak_speeding_hour || 'No active trend'}
              </p>
            </div>
            <div className="p-4 bg-yellow-500/10 dark:bg-yellow-900/20 rounded-lg border border-yellow-500/20">
              <p className="text-muted-foreground mb-2">Fatigue Alerts</p>
              <p className="text-foreground text-2xl">{fatigueAlertsCount} events</p>
              <p className="text-yellow-600 dark:text-yellow-400 mt-2">Fatigue Score: {safetyScoreData?.fatigue_score?.toFixed(0) || 'N/A'}</p>
            </div>
            <div className="p-4 bg-purple-500/10 dark:bg-purple-900/20 rounded-lg border border-purple-500/20">
              <p className="text-muted-foreground mb-2">Compliance Rate</p>
              <p className="text-foreground text-2xl">{safetyScoreData?.compliance_score?.toFixed(0) || 0}%</p>
              <p className="text-purple-600 dark:text-purple-400 mt-2">Alert acknowledgment</p>
            </div>
          </div>
        </Card>
      </TabsContent>

      {/* Predictive AI */}
      <TabsContent value="predictive" className="space-y-6">
        {/* AI Insights Panel - Dynamic recommendations from demand forecast */}
        <Card className="p-6 bg-blue-500/10 border-blue-500/20">
          <div className="flex items-center gap-3 mb-4">
            <Brain className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h3 className="text-foreground">AI-Generated Insights</h3>
          </div>
          <div className="space-y-3">
            {demandForecast?.recommendations?.map((rec, index) => (
              <div key={index} className="p-4 bg-card rounded-lg border border-blue-500/20">
                <p className="text-foreground mb-2">
                  <strong>📈 Recommendation:</strong> {rec}
                </p>
              </div>
            ))}
            {(!demandForecast?.recommendations || demandForecast.recommendations.length === 0) && (
              <>
                <div className="p-4 bg-card rounded-lg border border-blue-500/20">
                  <p className="text-foreground mb-2">
                    <strong>📈 Demand Forecast:</strong> Peak demand expected at {demandForecast?.peak_predicted_hour || 'N/A'} with {demandForecast?.peak_predicted_demand || 0} orders.
                  </p>
                </div>
                <div className="p-4 bg-card rounded-lg border border-orange-500/20">
                  <p className="text-foreground mb-2">
                    <strong>⚠️ Safety Alert:</strong> {fatigueAlertsCount} fatigue alerts detected. Consider enforcing break policies.
                  </p>
                </div>
                <div className="p-4 bg-card rounded-lg border border-green-500/20">
                  <p className="text-foreground mb-2">
                    <strong>💡 Optimization:</strong> Total orders (30d): {demandForecast?.current_demand || totalOrders}. Fleet utilization at {utilization}%.
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Demand Chart - Actual vs Predicted with Day Navigation */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-foreground">Demand — Actual vs Predicted</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousDay}
                className="p-2 rounded-lg bg-muted hover:bg-muted-foreground/10 transition-colors"
                title="Previous day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goToToday}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isToday
                  ? 'bg-blue-600 text-white'
                  : 'bg-muted hover:bg-muted-foreground/10 text-foreground'
                  }`}
              >
                <Calendar className="w-4 h-4 inline mr-1" />
                {demandDateLabel}
              </button>
              <button
                onClick={goToNextDay}
                disabled={isToday}
                className={`p-2 rounded-lg transition-colors ${isToday
                  ? 'bg-muted text-muted-foreground/30 cursor-not-allowed'
                  : 'bg-muted hover:bg-muted-foreground/10'
                  }`}
                title="Next day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={demandChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb40" />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 12 }}
                interval={1}
              />
              <YAxis allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '10px 14px' }}
                labelStyle={{ fontWeight: 'bold', marginBottom: 4, color: '#1e293b' }}
                itemStyle={{ color: '#334155' }}
                wrapperStyle={{ zIndex: 50 }}
              />
              <Legend />
              {isDemandToday && currentHourIndex !== null && currentHourIndex !== undefined && (
                <ReferenceLine
                  x={`${String(currentHourIndex).padStart(2, '0')}:00`}
                  stroke="#6366f1"
                  strokeDasharray="3 3"
                  label={{ value: 'Now', position: 'top', fill: '#6366f1', fontSize: 12 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#3b82f6"
                strokeWidth={3}
                name="Actual Demand"
                dot={{ r: 3, fill: '#3b82f6' }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                stroke="#a855f7"
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Predicted Demand"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          {isDemandToday && (
            <p className="text-muted-foreground text-xs mt-2 text-center">
              Actual demand line ends at current hour. Predicted demand shown for all 24 hours.
            </p>
          )}
        </Card>

        {/* Zone-wise Demand Chart — ML-Predicted */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-foreground">Zone-wise Demand — ML Predicted</h3>
            <select
              value={selectedZone || ''}
              onChange={(e) => setSelectedZone(e.target.value || null)}
              className="bg-muted text-foreground text-sm rounded-lg px-3 py-1.5 border border-border focus:outline-none"
            >
              <option value="">All Zones</option>
              {(zoneDemandHistory?.zones || []).map(zone => (
                <option key={zone.zone_id} value={zone.zone_id}>{zone.zone_name}</option>
              ))}
            </select>
          </div>
          {selectedZone ? (
            // Single zone view
            (() => {
              const zone = (zoneDemandHistory?.zones || []).find(z => z.zone_id === selectedZone);
              if (!zone) return <p className="text-muted-foreground text-sm">No data for selected zone.</p>;
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-foreground">{zone.zone_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Actual: {zone.total_actual} | Predicted: {zone.total_predicted}
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={zone.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb40" />
                      <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={2} />
                      <YAxis allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '10px 14px' }}
                        labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                        itemStyle={{ color: '#334155' }}
                        wrapperStyle={{ zIndex: 50 }}
                      />
                      <Legend />
                      {isDemandToday && currentHourIndex !== null && (
                        <ReferenceLine
                          x={`${String(currentHourIndex).padStart(2, '0')}:00`}
                          stroke="#6366f1" strokeDasharray="3 3"
                          label={{ value: 'Now', position: 'top', fill: '#6366f1', fontSize: 11 }}
                        />
                      )}
                      <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} name="Actual" dot={{ r: 2 }} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 5" name="Predicted" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          ) : (
            // Grid of all zones
            <div className="grid grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2">
              {(zoneDemandHistory?.zones || []).map(zone => (
                <div key={zone.zone_id} className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-foreground">{zone.zone_name}</p>
                    <p className="text-xs text-muted-foreground">
                      A:{zone.total_actual} P:{Math.round(zone.total_predicted)}
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={zone.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb20" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={5} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={25} />
                      <Tooltip contentStyle={{ fontSize: 11, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '8px 10px' }} itemStyle={{ color: '#334155' }} wrapperStyle={{ zIndex: 50 }} />
                      <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs mt-2 text-center">
            All predictions powered by ML ensemble (RandomForest + GradientBoosting + Ridge) per zone.
          </p>
        </Card>

        {/* Risk Predictions - Dynamic */}
        <div className="grid grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-foreground mb-4">High-Risk Zones</h3>
            <div className="space-y-3">
              {(predictiveRisks?.high_risk_zones || []).map((zone, idx) => (
                <div key={zone.zone_id || idx} className={`flex items-center justify-between p-3 ${zone.risk_level === 'Critical' ? 'bg-red-500/10' : zone.risk_level === 'High' ? 'bg-orange-500/10' : zone.risk_level === 'Medium' ? 'bg-yellow-500/10' : 'bg-muted'} rounded-lg`}>
                  <div className="flex items-center gap-3">
                    <MapPin className={`w-5 h-5 ${zone.risk_level === 'Critical' ? 'text-red-600 dark:text-red-400' : zone.risk_level === 'High' ? 'text-orange-600 dark:text-orange-400' : zone.risk_level === 'Medium' ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-foreground">{zone.zone_name || `Zone ${zone.zone_id}`}</p>
                      <p className="text-muted-foreground">{zone.reason}</p>
                    </div>
                  </div>
                  <Badge className={zone.risk_level === 'Critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400' : zone.risk_level === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400' : zone.risk_level === 'Medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' : 'bg-muted text-muted-foreground'}>{zone.risk_level} Risk</Badge>
                </div>
              ))}
              {(!predictiveRisks?.high_risk_zones || predictiveRisks.high_risk_zones.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-4">No risk data available.</p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-foreground mb-4">Drivers at Risk of Fatigue</h3>
            <div className="space-y-3">
              {(predictiveRisks?.drivers_at_risk || []).map((driver, idx) => (
                <div key={driver.driver_id || idx} className={`flex items-center justify-between p-3 ${driver.risk_level === 'Critical' ? 'bg-red-500/10' : driver.risk_level === 'High' ? 'bg-orange-500/10' : driver.risk_level === 'Medium' ? 'bg-yellow-500/10' : 'bg-muted'} rounded-lg`}>
                  <div className="flex items-center gap-3">
                    <Activity className={`w-5 h-5 ${driver.risk_level === 'Critical' ? 'text-red-600 dark:text-red-400' : driver.risk_level === 'High' ? 'text-orange-600 dark:text-orange-400' : driver.risk_level === 'Medium' ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-foreground">{driver.name}</p>
                      <p className="text-muted-foreground">{driver.continuous_hours} hrs continuous</p>
                    </div>
                  </div>
                  <Badge className={driver.risk_level === 'Critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400' : driver.risk_level === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400' : driver.risk_level === 'Medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' : 'bg-muted text-muted-foreground'}>{driver.risk_level}</Badge>
                </div>
              ))}
              {(!predictiveRisks?.drivers_at_risk || predictiveRisks.drivers_at_risk.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-4">No high-risk drivers currently tracked.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Weather-Based Predictions - Dynamic */}
        <Card className="p-6">
          <h3 className="text-foreground mb-4">Weather-Based Demand Impact</h3>
          <div className="grid grid-cols-3 gap-4">
            {(predictiveRisks?.weather_impacts || []).map((weather, idx) => (
              <div key={idx} className={`p-4 rounded-lg border flex flex-col justify-between ${weather.icon_type === 'rain' ? 'bg-blue-500/10 border-blue-500/20' : weather.icon_type === 'temperature' ? 'bg-orange-500/10 border-orange-500/20' : 'bg-green-500/10 border-green-500/20'}`}>
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    {weather.icon_type === 'rain' ? <CloudRain className="w-6 h-6 text-blue-600 dark:text-blue-400" /> : weather.icon_type === 'temperature' ? <Activity className="w-6 h-6 text-orange-600 dark:text-orange-400" /> : <Target className="w-6 h-6 text-green-600 dark:text-green-400" />}
                    <p className="text-foreground font-medium">{weather.condition}</p>
                  </div>
                  <p className="text-muted-foreground mb-2 text-sm">{weather.timeframe}</p>
                </div>
                <p className={`font-medium ${weather.icon_type === 'rain' ? 'text-blue-700 dark:text-blue-400' : weather.icon_type === 'temperature' ? 'text-orange-700 dark:text-orange-400' : 'text-green-700 dark:text-green-400'}`}>{weather.impact_text}</p>
              </div>
            ))}
            {(!predictiveRisks?.weather_impacts || predictiveRisks.weather_impacts.length === 0) && (
              <p className="text-muted-foreground text-sm col-span-3 text-center py-4">Loading live weather telemetry...</p>
            )}
          </div>
        </Card>
      </TabsContent>
    </Tabs>
  </div>);
}
