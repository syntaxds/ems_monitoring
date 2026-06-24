import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import PrivateRoute from './components/PrivateRoute';
import Shell from './components/Shell';
import Login from './pages/Login';
import Overview from './pages/Overview';
import FuelAnalytics from './pages/FuelAnalytics';
import Alerts from './pages/Alerts';
import ExportData from './pages/ExportData';
import Cameras from './pages/Cameras';
import UserManagement from './pages/UserManagement';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

// Layout wrapper: sidebar + topbar shell around private pages.
function PrivateLayout({ children }) {
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/overview"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <Overview />
                </PrivateLayout>
              </PrivateRoute>
            }
          />
          <Route
            path="/fuel"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <FuelAnalytics />
                </PrivateLayout>
              </PrivateRoute>
            }
          />
          <Route
            path="/cameras"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <Cameras />
                </PrivateLayout>
              </PrivateRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <Alerts />
                </PrivateLayout>
              </PrivateRoute>
            }
          />
          <Route
            path="/export"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <ExportData />
                </PrivateLayout>
              </PrivateRoute>
            }
          />
          <Route
            path="/users"
            element={
              <PrivateRoute>
                <PrivateLayout>
                  <UserManagement />
                </PrivateLayout>
              </PrivateRoute>
            }
          />

          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}
