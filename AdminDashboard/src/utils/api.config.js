import axios from 'axios';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('optiride_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});
apiClient.interceptors.response.use((response) => response, (error) => {
    if (error.response?.status === 401) {
        localStorage.removeItem('optiride_token');
        localStorage.removeItem('optiride_user');
        window.location.href = '/login';
    }
    return Promise.reject(error);
});
export const handleApiError = (error) => {
    if (error.response) {
        return {
            message: error.response.data?.detail || error.response.data?.message || 'An error occurred',
            status: error.response.status,
            data: error.response.data,
        };
    }
    else if (error.request) {
        return {
            message: 'No response from server. Please check your connection.',
            status: 0,
        };
    }
    else {
        return {    
            message: error.message || 'An unexpected error occurred',
            status: 0,
        };
    }
};

