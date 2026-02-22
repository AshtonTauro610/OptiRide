import { apiClient, handleApiError } from '@/utils/api.config';

export const allocationService = {
    initialAllocation: async () => {
        const response = await apiClient.post('/allocation/initial');
        return response.data;
    },

    reallocateFleet: async () => {
        const response = await apiClient.post('/allocation/reallocate');
        return response.data;
    },

    reallocateDriver: async (driverId) => {
        const response = await apiClient.post(`/allocation/drivers/${driverId}/reallocate`);
        return response.data;
    },

    manualAllocate: async (driverId, zoneId) => {
        const response = await apiClient.post('/allocation/manual', {
            driver_id: driverId,
            zone_id: zoneId
        });
        return response.data;
    },

    getAllocationStatus: async () => {
        const response = await apiClient.get('/allocation/status');
        return response.data;
    }
};
