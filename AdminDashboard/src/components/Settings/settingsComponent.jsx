import { useState } from "react";
import { Search, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "next-themes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, } from "@/components/ui/dialog";
import { AddUserDialog } from "./AddUserDialog";

export function Settings({ onLogout }) {
  const { theme, setTheme } = useTheme();
  const user = JSON.parse(localStorage.getItem("optiride_user") || "{}");
  const [profile, setProfile] = useState({
    name: user.name || "Admin User",
    email: user.email || "admin@optiride.ai",
    role: user.user_type || "System Admin",
  });
  const initials = profile.name.split(" ").map(n => n[0]).join("").toUpperCase();

  const [editProfile, setEditProfile] = useState(profile);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const handleSaveProfile = () => {
    setProfile(editProfile);
    // Update backend and localStorage here
    setIsEditOpen(false);
  };
  return (<div className="p-6 space-y-6">
    {/* Header */}
    <div>
      <h1 className="text-2xl font-bold">System Settings</h1>
      <p className="text-muted-foreground">Setup and edit system settings and preferences</p>
    </div>

    {/* Search Settings */}
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input placeholder="Search Settings..." className="pl-10" />
    </div>

    {/* Tabs */}
    <Tabs defaultValue="general" className="space-y-6">
      <TabsList className="bg-card border border-border">
        <TabsTrigger value="general">General Settings</TabsTrigger>
        <TabsTrigger value="admin">Admins' Settings</TabsTrigger>
      </TabsList>

      {/* General Settings */}
      <TabsContent value="general" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Admin Dashboard Theme</Label>
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light Theme</SelectItem>
                    <SelectItem value="dark">Dark Theme</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Map Update Mode</Label>
                <Select defaultValue="realtime">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">Real-Time</SelectItem>
                    <SelectItem value="interval">Interval (30s)</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data Refresh Interval</Label>
                <Select defaultValue="45s">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15s">15s</SelectItem>
                    <SelectItem value="30s">30s</SelectItem>
                    <SelectItem value="45s">45s</SelectItem>
                    <SelectItem value="60s">60s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>AI Insights Settings</Label>
                <Select defaultValue="full">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full analytical insights</SelectItem>
                    <SelectItem value="basic">Basic insights</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data Retention Period</Label>
                <Select defaultValue="90">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Auto Weekly Reporting</Label>
                <Select defaultValue="on">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">On</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Date and Time Format</Label>
                <Select defaultValue="ddmmyyyy">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddmmyyyy">DD/MM/YYYY</SelectItem>
                    <SelectItem value="mmddyyyy">MM/DD/YYYY</SelectItem>
                    <SelectItem value="yyyymmdd">YYYY-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fatigue Alert Threshold</Label>
                <Select defaultValue="medium">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Fatigue</SelectItem>
                    <SelectItem value="medium">Medium Fatigue</SelectItem>
                    <SelectItem value="high">High Fatigue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Default Logs/Reports File Format for Download</Label>
                <Select defaultValue="multiple">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple">4 Selected (CSV, PDF, XLS & TXT)</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="xls">XLS</SelectItem>
                    <SelectItem value="txt">TXT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Admin Settings */}
      <TabsContent value="admin" className="space-y-6">
        {/* Admin Profile Card */}
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14 bg-primary">
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{profile.name}</p>
                  <p className="text-sm text-muted-foreground">{profile.email}</p>
                </div>
              </div>
              <Dialog open={isEditOpen} onOpenChange={(open) => {
                setIsEditOpen(open);
                if (open)
                  setEditProfile(profile);
              }}>
                <DialogTrigger asChild>
                  <Button variant="default" size="sm" onClick={() => setIsEditOpen(true)}>
                    Edit
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Profile</DialogTitle>
                    <DialogDescription>Update your profile details and preferences.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input id="fullName" value={editProfile.name} onChange={(event) => setEditProfile((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" value={editProfile.email} onChange={(event) => setEditProfile((current) => ({ ...current, email: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Input id="role" value={editProfile.role} onChange={(event) => setEditProfile((current) => ({ ...current, role: event.target.value }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="secondary" onClick={() => setIsEditOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveProfile}>Save changes</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        {/* User Management Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">User Management</CardTitle>
                <CardDescription>Create and manage driver and administrator accounts</CardDescription>
              </div>
              <AddUserDialog />
            </div>
          </CardHeader>
        </Card>

        {/* Settings Grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Driver Sign up</Label>
                    <p className="text-xs text-muted-foreground">Allow new users to sign up</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Notification about Newly added Drivers</Label>
                    <p className="text-xs text-muted-foreground">Notify users about new Drivers</p>
                  </div>
                  <Switch />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Notifications</Label>
                    <p className="text-xs text-muted-foreground">Send notifications to Drivers</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Profile Edit</Label>
                    <p className="text-xs text-muted-foreground">Allow Drivers to edit their profile</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logout Button */}
        <div className="flex justify-end">
          <Button variant="destructive" className="gap-2" onClick={onLogout}>
            <LogOut className="w-4 h-4" />
            Logout
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  </div>);
}

