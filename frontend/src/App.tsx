import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { HomeRedirect } from './pages/HomeRedirect'
import { TestDashboard } from './pages/TestDashboard'
import { ChatPage } from './pages/ChatPage'
import { AdminOnboarding } from './pages/AdminOnboarding'
import { AdminSetup } from './pages/AdminSetup'
import { AdminInstanceConfig } from './pages/AdminInstanceConfig'
import { AdminUserConfig } from './pages/AdminUserConfig'
import { AdminAIConfig } from './pages/AdminAIConfig'
import { AdminDeploymentConfig } from './pages/AdminDeploymentConfig'
import { AdminDocumentUpload } from './pages/AdminDocumentUpload'
import { AdminDatabaseExplorer } from './pages/AdminDatabaseExplorer'
import { UserOnboarding } from './pages/UserOnboarding'
import { UserAuth } from './pages/UserAuth'
import { UserTypeSelection } from './pages/UserTypeSelection'
import { UserProfile } from './pages/UserProfile'
import { VerifyMagicLink } from './pages/VerifyMagicLink'
import { PendingApproval } from './pages/PendingApproval'
import { AdminRoute } from './components/shared/AdminRoute'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/test-dashboard" element={<TestDashboard />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin" element={<AdminOnboarding />} />
        <Route path="/admin/setup" element={<AdminRoute><AdminSetup /></AdminRoute>} />
        <Route path="/admin/instance" element={<AdminRoute><AdminInstanceConfig /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><AdminUserConfig /></AdminRoute>} />
        <Route path="/admin/ai" element={<AdminRoute><AdminAIConfig /></AdminRoute>} />
        <Route path="/admin/deployment" element={<AdminRoute><AdminDeploymentConfig /></AdminRoute>} />
        <Route path="/admin/upload" element={<AdminRoute><AdminDocumentUpload /></AdminRoute>} />
        <Route path="/admin/database" element={<AdminRoute><AdminDatabaseExplorer /></AdminRoute>} />
        <Route path="/login" element={<UserOnboarding />} />
        <Route path="/auth" element={<UserAuth />} />
        <Route path="/user-type" element={<UserTypeSelection />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/verify" element={<VerifyMagicLink />} />
        <Route path="/pending" element={<PendingApproval />} />
      </Routes>
    </Router>
  )
}

export default App
