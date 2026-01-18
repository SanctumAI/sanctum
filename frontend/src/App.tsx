import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { TestDashboard } from './pages/TestDashboard'
import { ChatPage } from './pages/ChatPage'
import { AdminOnboarding } from './pages/AdminOnboarding'
import { AdminSetup } from './pages/AdminSetup'
import { AdminDocumentUpload } from './pages/AdminDocumentUpload'
import { AdminDatabaseExplorer } from './pages/AdminDatabaseExplorer'
import { UserOnboarding } from './pages/UserOnboarding'
import { UserAuth } from './pages/UserAuth'
import { UserProfile } from './pages/UserProfile'
import { VerifyMagicLink } from './pages/VerifyMagicLink'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<TestDashboard />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin" element={<AdminOnboarding />} />
        <Route path="/admin/setup" element={<AdminSetup />} />
        <Route path="/admin/upload" element={<AdminDocumentUpload />} />
        <Route path="/admin/database" element={<AdminDatabaseExplorer />} />
        <Route path="/login" element={<UserOnboarding />} />
        <Route path="/auth" element={<UserAuth />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/verify" element={<VerifyMagicLink />} />
      </Routes>
    </Router>
  )
}

export default App
