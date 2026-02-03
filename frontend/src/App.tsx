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

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/test-dashboard" element={<TestDashboard />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin" element={<AdminOnboarding />} />
        <Route path="/admin/setup" element={<AdminSetup />} />
        <Route path="/admin/instance" element={<AdminInstanceConfig />} />
        <Route path="/admin/users" element={<AdminUserConfig />} />
        <Route path="/admin/ai" element={<AdminAIConfig />} />
        <Route path="/admin/deployment" element={<AdminDeploymentConfig />} />
        <Route path="/admin/upload" element={<AdminDocumentUpload />} />
        <Route path="/admin/database" element={<AdminDatabaseExplorer />} />
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
