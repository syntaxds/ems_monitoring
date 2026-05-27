import axios from 'axios';

const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const api = axios.create({ baseURL });

// Resolve a backend-relative media path (e.g. "/media/cameras/x.jpg") to an
// absolute URL the browser can load across origins.
export const API_BASE_URL = baseURL;
export const mediaUrl = (p) => (p ? `${baseURL}${p}` : null);

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

export const getAlerts = (status, deviceId) =>
  api.get('/api/alerts', { params: { status, device_id: deviceId } });

export const acknowledgeAlert = (id) =>
  api.put(`/api/alerts/${id}/acknowledge`);

export const generateReport = (body) =>
  api.post('/api/reports/generate', body, { responseType: 'blob' });

export default api;
