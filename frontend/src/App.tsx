import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Sequences } from './pages/Sequences';
import { CreateSequenceWizard } from './pages/CreateSequenceWizard';
// import { SequenceBuilder } from './pages/SequenceBuilder'; // Legacy - removed for Route Consolidation
import { SequenceBuilderWizard } from './pages/SequenceBuilderWizard';
import { Templates } from './pages/Templates';
import { EmailAccounts } from './pages/EmailAccounts';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { ImportLists } from './pages/ImportLists';
import { SequenceRecipientsStep } from './pages/SequenceRecipientsStep';
import { SequenceRecipientsManager } from './pages/SequenceRecipientsManager';
import { SequencePreviewTestPage } from './pages/SequencePreviewTestPage';

function LegacyBuilderRedirect() {
  const { id } = useParams();
  return <Navigate to={`/sequences/${id}/builder-v2`} replace />;
}

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
            {/* Legacy Create Sequence Form Redirect */}
            <Route path="/sequences/create" element={<Navigate to="/sequences" replace />} />
            {/* <Route path="/sequences/create" element={<CreateSequenceWizard />} /> */}
            {/* Legacy builder route redirect */}
            <Route path="/sequences/:id/builder" element={<LegacyBuilderRedirect />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/email-accounts" element={<EmailAccounts />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/import-lists" element={<ImportLists />} />
            
            {/* Fallback to Dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          {/* Full-screen Wizard Routes */}
          <Route path="/sequences/:id/builder-v2" element={<SequenceBuilderWizard />} />
          <Route path="/sequences/:id/recipients" element={<SequenceRecipientsStep />} />
          <Route path="/sequences/:id/recipients/manage" element={<SequenceRecipientsManager />} />
          <Route path="/sequences/:id/preview-test" element={<SequencePreviewTestPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
