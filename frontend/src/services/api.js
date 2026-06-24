import axios from 'axios';

const baseURL = process.env.REACT_APP_API_URL || window.location.origin;

const api = axios.create({ baseURL });

// Resolve a media path the browser can load. Absolute URLs (e.g. a live camera
// stream "http://<cam-ip>/stream") are returned as-is; backend-relative paths
// (e.g. "/media/cameras/x.jpg") are prefixed with the API base.
export const API_BASE_URL = baseURL;
export const mediaUrl = (p) => {
  if (!p) return null;
  return /^https?:\/\//i.test(p) ? p : `${baseURL}${p}`;
};

// Attach JWT to every request if present.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ems_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear the session and bounce to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('ems_token');
      localStorage.removeItem('ems_user');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

// --- Named API wrappers (components must use these, never axios directly) ---

export const login = (username, password) =>
  api.post('/api/auth/login', { username, password });

export const getDevices = () => api.get('/api/devices');

export const getDeviceFuel = (id, start, end) =>
  api.get(`/api/devices/${id}/fuel`, { params: { start, end } });

export const getDeviceGPS = (id, start, end) =>
  api.get(`/api/devices/${id}/gps`, { params: { start, end } });

export const getDeviceCameraLatest = (id) =>
  api.get(`/api/devices/${id}/camera/latest`);

// Backend-proxied live MJPEG stream URL for an <img src>. Same-origin (avoids
// CORS/CSP), and the backend keeps a single upstream connection to the camera.
// Token goes in the query because an <img> can't send an Authorization header.
export const cameraStreamUrl = (id) => {
  const token = localStorage.getItem('ems_token') || '';
  return `${baseURL}/api/devices/${id}/camera/stream?token=${encodeURIComponent(token)}`;
};

export const getAlerts = (status, deviceId) =>
  api.get('/api/alerts', { params: { status, device_id: deviceId } });

export const acknowledgeAlert = (id) =>
  api.put(`/api/alerts/${id}/acknowledge`);

export const generateReport = (body) =>
  api.post('/api/reports/generate', body, { responseType: 'blob' });

export const getUsers = () => api.get('/api/users');
export const createUser = (data) => api.post('/api/users', data);
export const updateUser = (id, data) => api.put(`/api/users/${id}`, data);
export const deactivateUser = (id) => api.put(`/api/users/${id}/deactivate`);
export const reactivateUser = (id) => api.put(`/api/users/${id}/reactivate`);

export const forgotPassword = (email) => api.post('/api/auth/forgot-password', { email });
export const resetPassword = (token, newPassword) =>
  api.post('/api/auth/reset-password', { token, newPassword });

export default api;
