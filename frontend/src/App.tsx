import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Sequences } from './pages/Sequences';
import { CreateSequenceWizard } from './pages/CreateSequenceWizard';
import { SequenceBuilder } from './pages/SequenceBuilder';
import { Templates } from './pages/Templates';
import { EmailAccounts } from './pages/EmailAccounts';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';

function App() {
  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sequences" element={<Sequences />} />
            <Route path="/sequences/create" element={<CreateSequenceWizard />} />
            <Route path="/sequences/:id/builder" element={<SequenceBuilder />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/email-accounts" element={<EmailAccounts />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            
            {/* Fallback to Dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
