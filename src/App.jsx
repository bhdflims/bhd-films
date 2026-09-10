import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { InstallPromptProvider } from './context/InstallPromptContext'

import AppLayout from './components/navigation/AppLayout'
import BareLayout from './components/navigation/BareLayout'
import ProtectedRoute from './components/common/ProtectedRoute'
import AdminRoute from './components/common/AdminRoute'
import ManifestSwitcher from './components/common/ManifestSwitcher'
import AdminHomeRedirect from './components/common/AdminHomeRedirect'
import MaintenanceGate from './components/common/MaintenanceGate'

import Home from './pages/customer/Home'
import Services from './pages/customer/Services'
import CategoryOrder from './pages/customer/CategoryOrder'
import Offers from './pages/customer/Offers'
import OrderHistory from './pages/customer/OrderHistory'
import Profile from './pages/customer/Profile'
import Wallet from './pages/customer/Wallet'
import AddFunds from './pages/customer/AddFunds'
import PaymentQR from './pages/customer/PaymentQR'
import FundRequests from './pages/customer/FundRequests'
import FundHistory from './pages/customer/FundHistory'
import Support from './pages/customer/Support'
import NewSupportTicket from './pages/customer/NewSupportTicket'
import SupportTicketDetail from './pages/customer/SupportTicketDetail'
import About from './pages/customer/About'
import Terms from './pages/customer/Terms'
import Login from './pages/customer/Login'
import OrderSuccess from './pages/customer/OrderSuccess'

import AdminLayout from './pages/admin/AdminLayout'
import AdminLogin from './pages/admin/AdminLogin'
import Dashboard from './pages/admin/Dashboard'
import Customers from './pages/admin/Customers'
import CustomerDetail from './pages/admin/CustomerDetail'
import Categories from './pages/admin/Categories'
import AdminServices from './pages/admin/Services'
import RateControl from './pages/admin/RateControl'
import BulkPricing from './pages/admin/BulkPricing'
import AdminOrders from './pages/admin/Orders'
import AdminFundRequests from './pages/admin/FundRequests'
import WalletTransactions from './pages/admin/WalletTransactions'
import PaymentSettings from './pages/admin/PaymentSettings'
import AdminOffers from './pages/admin/Offers'
import Coupons from './pages/admin/Coupons'
import Refunds from './pages/admin/Refunds'
import SupportMessages from './pages/admin/SupportMessages'
import Reports from './pages/admin/Reports'
import AuditLog from './pages/admin/AuditLog'
import AdminUsers from './pages/admin/AdminUsers'
import MaintenanceMode from './pages/admin/MaintenanceMode'

export default function App() {
  return (
    <AuthProvider>
      <InstallPromptProvider>
      <BrowserRouter>
        <ManifestSwitcher />
        <AdminHomeRedirect />
        <MaintenanceGate>
        <Routes>
          {/* Customer app - bottom nav layout */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/services/:slug" element={<CategoryOrder />} />
            <Route path="/offers" element={<Offers />} />
            <Route
              path="/support"
              element={
                <ProtectedRoute>
                  <Support />
                </ProtectedRoute>
              }
            />
            <Route
              path="/support/new"
              element={
                <ProtectedRoute>
                  <NewSupportTicket />
                </ProtectedRoute>
              }
            />
            <Route
              path="/support/:id"
              element={
                <ProtectedRoute>
                  <SupportTicketDetail />
                </ProtectedRoute>
              }
            />
            <Route path="/about" element={<About />} />
            <Route path="/terms" element={<Terms />} />
            <Route
              path="/orders"
              element={
                <ProtectedRoute>
                  <OrderHistory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wallet"
              element={
                <ProtectedRoute>
                  <Wallet />
                </ProtectedRoute>
              }
            />
            <Route
              path="/add-funds"
              element={
                <ProtectedRoute>
                  <AddFunds />
                </ProtectedRoute>
              }
            />
            <Route
              path="/fund-requests"
              element={
                <ProtectedRoute>
                  <FundRequests />
                </ProtectedRoute>
              }
            />
            <Route
              path="/fund-history"
              element={
                <ProtectedRoute>
                  <FundHistory />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Customer full-screen flows - no bottom nav */}
          <Route element={<BareLayout />}>
            <Route path="/login" element={<Login />} />
            <Route
              path="/payment-qr"
              element={
                <ProtectedRoute>
                  <PaymentQR />
                </ProtectedRoute>
              }
            />
            <Route
              path="/order-success"
              element={
                <ProtectedRoute>
                  <OrderSuccess />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Admin panel */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="categories" element={<Categories />} />
            <Route path="services" element={<AdminServices />} />
            <Route path="rate-control" element={<RateControl />} />
            <Route path="bulk-pricing" element={<BulkPricing />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="fund-requests" element={<AdminFundRequests />} />
            <Route path="wallet-transactions" element={<WalletTransactions />} />
            <Route path="payment-settings" element={<PaymentSettings />} />
            <Route path="offers" element={<AdminOffers />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="refunds" element={<Refunds />} />
            <Route path="support" element={<SupportMessages />} />
            <Route path="reports" element={<Reports />} />
            <Route path="audit-log" element={<AuditLog />} />
            <Route path="admins" element={<AdminUsers />} />
            <Route path="maintenance-mode" element={<MaintenanceMode />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </MaintenanceGate>
      </BrowserRouter>
      </InstallPromptProvider>
    </AuthProvider>
  )
}
