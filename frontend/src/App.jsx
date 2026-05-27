import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Header from './components/Header';
import Login from './pages/Login';
import Overview from './pages/Overview';
import FuelAnalytics from './pages/FuelAnalytics';
import Alerts from './pages/Alerts';
import ExportData from './pages/ExportData';
import Cameras from './pages/Cameras';

// Layout wrapper that renders the persistent header above private pages.
function PrivateLayout({ children }) {
  return (
    <div className="app-shell">
      <Header />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

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

          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
