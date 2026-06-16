import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const TopNav: React.FC = () => {
  const { user, logout } = useAuthStore();
  const location = useLocation();

  const getPageTitle = () => {
    const path = location.pathname.split('/')[1];
    if (!path) return 'Dashboard';
    return path.charAt(0).toUpperCase() + path.slice(1).replace('-', ' ');
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-8">
      <h1 className="text-2xl font-semibold text-gray-900">{getPageTitle()}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 border-r border-gray-200 pr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100">
            <UserIcon className="h-4 w-4 text-primary-700" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900">
              {user?.first_name} {user?.last_name}
            </span>
            <span className="text-xs text-gray-500">{user?.email}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} className="text-gray-500 hover:text-red-600 hover:bg-red-50">
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </header>
  );
};
