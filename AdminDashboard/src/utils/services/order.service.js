import { apiClient, handleApiError } from '@/utils/api.config';
export const orderService = {
    // Create order (Admin only)
    async createOrder(data) {
        try {
            const response = await apiClient.post('/orders/', data);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Webhook to create order (external systems)
    async webhookCreateOrder(data, autoAssign = false) {
        try {
            const response = await apiClient.post('/orders/webhook/new-order', data, {
                params: { auto_assign: autoAssign },
            });
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get all orders (Admin only)
    async getAllOrders(status, driverId, pickupZone) {
        try {
            const response = await apiClient.get('/orders/', {
                params: { status, driver_id: driverId, pickup_zone: pickupZone },
            });
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get pending orders (Admin only)
    async getPendingOrders(zoneId) {
        try {
            const response = await apiClient.get('/orders/pending', {
                params: { zone_id: zoneId },
            });
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get order statistics (Admin only)
    async getOrderStats(startDate, endDate) {
        try {
            const response = await apiClient.get('/orders/stats', {
                params: { start_date: startDate, end_date: endDate },
            });
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get order by ID
    async getOrderById(orderId) {
        try {
            const response = await apiClient.get(`/orders/${orderId}`);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Update order (Admin only)
    async updateOrder(orderId, data) {
        try {
            const response = await apiClient.patch(`/orders/${orderId}`, data);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Assign order to driver (Admin only)
    async assignOrder(orderId, driverId) {
        try {
            const response = await apiClient.post(`/orders/${orderId}/assign`, {
                driver_id: driverId,
            });
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Auto-assign order (Admin only)
    async autoAssignOrder(orderId) {
        try {
            const response = await apiClient.post(`/orders/${orderId}/auto-assign`);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get driver's orders (Driver only)
    async getDriverOrders() {
        try {
            const response = await apiClient.get('/orders/driver/orders');
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Pickup order (Driver only)
    async pickupOrder(orderId, data) {
        try {
            const response = await apiClient.post(`/orders/${orderId}/pickup`, data);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Deliver order (Driver only)
    async deliverOrder(orderId, data) {
        try {
            const response = await apiClient.post(`/orders/${orderId}/deliver`, data);
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
    // Get active order locations (Admin only)
    async getActiveOrderLocations() {
        try {
            const response = await apiClient.get('/orders/active-locations');
            return response.data;
        }
        catch (error) {
            throw handleApiError(error);
        }
    },
};

