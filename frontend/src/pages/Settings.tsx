import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../store/useAuthStore';

export const Settings: React.FC = () => {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-gray-500">Manage your account settings and preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>Update your personal information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="First Name" defaultValue={user?.first_name} />
            <Input label="Last Name" defaultValue={user?.last_name} />
          </div>
          <Input label="Email Address" type="email" defaultValue={user?.email} disabled />
          <Input label="Organization" defaultValue={user?.organization_name} />
          <div className="pt-4">
            <Button>Save Changes</Button>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Manage your password and security settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Current Password" type="password" />
          <Input label="New Password" type="password" />
          <Input label="Confirm New Password" type="password" />
          <div className="pt-4">
            <Button variant="secondary">Update Password</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
