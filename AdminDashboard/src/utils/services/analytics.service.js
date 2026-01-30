import { apiClient, handleApiError } from '@/utils/api.config';

export const analyticsService = {
    async getDashboardOverview(period = 'today') {
        try {
            const response = await apiClient.get('/analytics/dashboard', {
                params: { period }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getRealtimeMetrics() {
        try {
            const response = await apiClient.get('/analytics/realtime');
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getFleetDashboardCharts() {
        try {
            const response = await apiClient.get('/analytics/fleet-charts');
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getTrends(metric, period = 'last_7_days', granularity = 'daily') {
        try {
            const response = await apiClient.get(`/analytics/trends/${metric}`, {
                params: { period, granularity }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async analyzePerformance(entityType, entityId = null, period = 'this_month') {
        try {
            const response = await apiClient.get(`/analytics/performance/${entityType}`, {
                params: {
                    entity_id: entityId,
                    period
                }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getZoneHeatmap(hour = null) {
        try {
            const response = await apiClient.get('/analytics/zones/heatmap', {
                params: { hour }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getZoneSummary(zoneId, period = 'this_month') {
        try {
            const response = await apiClient.get(`/analytics/zones/${zoneId}/summary`, {
                params: { period }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async getDriverSummary(driverId, period = 'this_month') {
        try {
            const response = await apiClient.get(`/analytics/drivers/${driverId}/summary`, {
                params: { period }
            });
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    },
    async generateReport(reportRequest) {
        try {
            const response = await apiClient.post('/analytics/reports', reportRequest);
            return response.data;
        } catch (error) {
            throw handleApiError(error);
        }
    }
};