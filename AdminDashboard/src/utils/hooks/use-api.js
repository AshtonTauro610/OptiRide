import { useState, useEffect, useCallback } from 'react';
import { driverService } from '@/utils/services/driver.service';
import { orderService } from '@/utils/services/order.service';
import { safetyService } from '@/utils/services/safety.service';
import { analyticsService } from '@/utils/services/analytics.service';
import { allocationService } from '@/utils/services/allocation.service';


export const useReallocateDriver = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const reallocate = useCallback(async (driverId) => {
        try {
            setLoading(true);
            setError(null);
            const result = await allocationService.reallocateDriver(driverId);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { reallocate, loading, error };
};

/**
 * Hook for fetching current allocation status and zone metrics
 */
export const useAllocationStatus = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchStatus = useCallback(async () => {
        try {
            setLoading(true);
            const result = await allocationService.getAllocationStatus();
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    return { data, loading, error, refetch: fetchStatus };
};

/**
 * Hook for manual driver allocation to a specific zone
 */
export const useManualAllocate = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const manualAllocate = useCallback(async (driverId, zoneId) => {
        try {
            setLoading(true);
            setError(null);
            const result = await allocationService.manualAllocate(driverId, zoneId);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { manualAllocate, loading, error };
};

/**
 * Hook for triggering initial fleet-wide allocation
 */
export const useInitialAllocation = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const initialAllocation = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await allocationService.initialAllocation();
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { initialAllocation, loading, error };
};
// Driver hooks
export const useDrivers = (skip = 0, limit = 10) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchDrivers = useCallback(async () => {
        try {
            setLoading(true);
            const result = await driverService.listDrivers(skip, limit);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [skip, limit]);
    useEffect(() => {
        fetchDrivers();
    }, [fetchDrivers]);
    return { data, loading, error, refetch: fetchDrivers };
};
export const useDriversSummary = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchSummary = useCallback(async () => {
        try {
            setLoading(true);
            const result = await driverService.getDriversSummary();
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);
    return { data, loading, error, refetch: fetchSummary };
};
export const useActiveDriverLocations = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchLocations = useCallback(async () => {
        try {
            setLoading(true);
            const result = await driverService.getActiveDriverLocations();
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        fetchLocations();
    }, [fetchLocations]);
    return { data, loading, error, refetch: fetchLocations };
};
export const useDriverById = (driverId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchDriver = useCallback(async () => {
        if (!driverId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const result = await driverService.getDriverById(driverId);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [driverId]);
    useEffect(() => {
        fetchDriver();
    }, [fetchDriver]);
    return { data, loading, error, refetch: fetchDriver };
};
export const useDriverPerformanceStats = (driverId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchStats = useCallback(async () => {
        if (!driverId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const result = await driverService.getDriverPerformanceStats(driverId);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [driverId]);
    useEffect(() => {
        fetchStats();
    }, [fetchStats]);
    return { data, loading, error, refetch: fetchStats };
};
// Order hooks
export const useOrders = (status, driverId, pickupZone) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchOrders = useCallback(async () => {
        try {
            setLoading(true);
            const result = await orderService.getAllOrders(status, driverId, pickupZone);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [status, driverId, pickupZone]);
    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);
    return { data, loading, error, refetch: fetchOrders };
};
export const usePendingOrders = (zoneId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchPending = useCallback(async () => {
        try {
            setLoading(true);
            const result = await orderService.getPendingOrders(zoneId);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [zoneId]);
    useEffect(() => {
        fetchPending();
    }, [fetchPending]);
    return { data, loading, error, refetch: fetchPending };
};
export const useOrderStats = (startDate, endDate) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const result = await orderService.getOrderStats(startDate, endDate);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [startDate, endDate]);
    useEffect(() => {
        fetchStats();
    }, [fetchStats]);
    return { data, loading, error, refetch: fetchStats };
};
export const useSafetyAlerts = (driverId, alertType, acknowledged, skip, limit) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchAlerts = useCallback(async () => {
        try {
            setLoading(true);
            const result = await safetyService.listAlerts(driverId, alertType, acknowledged, skip, limit);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [driverId, alertType, acknowledged, skip, limit]);
    useEffect(() => {
        fetchAlerts();
    }, [fetchAlerts]);
    return { data, loading, error, refetch: fetchAlerts };
};
export const useFleetDashboardCharts = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchAnalytics = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getFleetDashboardCharts();
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        fetchAnalytics();
    }, [fetchAnalytics]);
    return { data, loading, error, refetch: fetchAnalytics };
};
export const useDashboardOverview = (period) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchOverview = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getDashboardOverview(period);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [period]);
    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);
    return { data, loading, error, refetch: fetchOverview };
};
export const useRealtimeMetrics = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchMetrics = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getRealtimeMetrics();
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        fetchMetrics();
    }, [fetchMetrics]);
    return { data, loading, error, refetch: fetchMetrics };
};
export const useTrends = (metric, period, granularity) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchTrends = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getTrends(metric, period, granularity);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [metric, period, granularity]);
    useEffect(() => {
        fetchTrends();
    }, [fetchTrends]);
    return { data, loading, error, refetch: fetchTrends };
};
export const useZoneHeatMap = (hour) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchHeatMap = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getZoneHeatmap(hour);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [hour]);
    useEffect(() => {
        fetchHeatMap();
    }, [fetchHeatMap]);
    return { data, loading, error, refetch: fetchHeatMap };
};

// Performance Analysis hook
export const usePerformanceAnalysis = (entityType, entityId, period = 'this_month') => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchPerformance = useCallback(async () => {
        if (!entityType) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const result = await analyticsService.analyzePerformance(entityType, entityId, period);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [entityType, entityId, period]);
    useEffect(() => {
        fetchPerformance();
    }, [fetchPerformance]);
    return { data, loading, error, refetch: fetchPerformance };
};

// Driver Analytics Summary hook
export const useDriverAnalyticsSummary = (driverId, period = 'this_month') => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchSummary = useCallback(async () => {
        if (!driverId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const result = await analyticsService.getDriverSummary(driverId, period);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [driverId, period]);
    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);
    return { data, loading, error, refetch: fetchSummary };
};

// Zone Analytics Summary hook
export const useZoneAnalyticsSummary = (zoneId, period = 'this_month') => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchSummary = useCallback(async () => {
        if (!zoneId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const result = await analyticsService.getZoneSummary(zoneId, period);
            setData(result);
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [zoneId, period]);
    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);
    return { data, loading, error, refetch: fetchSummary };
};

// Generate Report hook (mutation-style hook)
export const useGenerateReport = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateReport = useCallback(async (reportRequest) => {
        try {
            setLoading(true);
            setError(null);
            const result = await analyticsService.generateReport(reportRequest);
            setData(result);
            return result;
        }
        catch (err) {
            setError(err);
            throw err;
        }
        finally {
            setLoading(false);
        }
    }, []);

    return { data, loading, error, generateReport };
};

// ============================================
// NEW AGGREGATED ANALYTICS HOOKS
// ============================================

/**
 * Hook for fetching aggregated alerts summary
 * @param {string} period - 'today', 'last_7_days', 'this_month'
 */
export const useAlertsSummary = (period = 'last_7_days') => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchAlertsSummary = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getAlertsSummary(period);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        fetchAlertsSummary();
    }, [fetchAlertsSummary]);

    return { data, loading, error, refetch: fetchAlertsSummary };
};

/**
 * Hook for fetching fleet-wide safety score
 * @param {string} period - 'today', 'last_7_days', 'this_month'
 */
export const useSafetyScore = (period = 'last_7_days') => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSafetyScore = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getSafetyScore(period);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        fetchSafetyScore();
    }, [fetchSafetyScore]);

    return { data, loading, error, refetch: fetchSafetyScore };
};

/**
 * Hook for fetching top performing drivers
 * @param {string} period - 'today', 'last_7_days', 'this_month'
 * @param {number} limit - Number of top performers (1-20)
 */
export const useTopPerformers = (period = 'last_7_days', limit = 5) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchTopPerformers = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getTopPerformers(period, limit);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [period, limit]);

    useEffect(() => {
        fetchTopPerformers();
    }, [fetchTopPerformers]);

    return { data, loading, error, refetch: fetchTopPerformers };
};

/**
 * Hook for fetching demand forecast
 * @param {number} hours - Number of hours to forecast (1-24)
 */
export const useDemandForecast = (hours = 12) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchDemandForecast = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getDemandForecast(hours);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [hours]);

    useEffect(() => {
        fetchDemandForecast();
    }, [fetchDemandForecast]);

    return { data, loading, error, refetch: fetchDemandForecast };
};

/**
 * Hook for fetching demand history for a specific date
 * @param {string|null} date - YYYY-MM-DD format, null for today
 */
export const useDemandHistory = (date = null) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchDemandHistory = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getDemandHistory(date);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        fetchDemandHistory();
    }, [fetchDemandHistory]);

    return { data, loading, error, refetch: fetchDemandHistory };
};

/**
 * Hook for fetching zone-wise demand history for a specific date
 * @param {string|null} date - YYYY-MM-DD format, null for today
 */
export const useZoneDemandHistory = (date = null) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchZoneDemandHistory = useCallback(async () => {
        try {
            setLoading(true);
            const result = await analyticsService.getZoneDemandHistory(date);
            setData(result);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        fetchZoneDemandHistory();
    }, [fetchZoneDemandHistory]);

    return { data, loading, error, refetch: fetchZoneDemandHistory };
};

// Custom hook for periodic data refresh
export const usePolling = (callback, interval = 5000) => {
    useEffect(() => {
        const id = setInterval(callback, interval);
        return () => clearInterval(id);
    }, [callback, interval]);
};
