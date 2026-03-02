import { useState } from "react";
import { Plus, UserPlus, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/utils/hooks/use-toast";
import { authService } from "@/utils/services/auth.service";

export function AddUserDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Get current user info to determine access level
  const user = JSON.parse(localStorage.getItem("optiride_user") || "{}");
  const currentUserAccessLevel = user.access_level || 1;
  const isSeniorAdmin = currentUserAccessLevel >= 3;

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    phone_number: "",
    name: "",
    role: "driver", // Default to driver
    department: "",
    access_level: 1,
    admin_role: "admin", // Default for admins
    vehicle_type: "bike", // Default for drivers
    license_plate: "",
  });

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      email: "",
      password: "",
      phone_number: "",
      name: "",
      role: "driver",
      department: "",
      access_level: 1,
      admin_role: "admin",
      vehicle_type: "bike",
      license_plate: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate phone number format
      if (formData.phone_number && !formData.phone_number.startsWith("+")) {
        toast({
          title: "Invalid Phone Number",
          description: "Phone number must start with + and country code (e.g., +1234567890)",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Prepare the data to send
      const userData = {
        email: formData.email,
        password: formData.password,
        phone_number: formData.phone_number || null,
        name: formData.name,
        role: formData.role,
      };

      // Add role-specific fields
      if (formData.role === "administrator") {
        userData.department = formData.department;
        userData.access_level = formData.access_level;
        userData.admin_role = formData.admin_role;
      } else if (formData.role === "driver") {
        userData.vehicle_type = formData.vehicle_type;
        userData.license_plate = formData.license_plate;
      }

      // Call the API
      const response = await authService.createUser(userData);

      toast({
        title: "Success!",
        description: `${formData.role === "driver" ? "Driver" : "Administrator"} created successfully.`,
      });

      resetForm();
      setOpen(false);
    } catch (error) {
      console.error("Error creating user:", error);

      let errorMessage = "Failed to create user. Please try again.";

      // Parse specific backend error messages for cleaner display
      const backendDetail = error.response?.data?.detail || error.message || "";

      if (backendDetail.includes("TOO_SHORT") && backendDetail.includes("INVALID_PHONE_NUMBER")) {
        errorMessage = "Invalid Phone Number: The number is too short.";
      } else if (backendDetail.includes("Email already exists")) {
        errorMessage = "A user with this email already exists.";
      } else if (backendDetail.includes("Phone number already exists")) {
        errorMessage = "This phone number is already registered.";
      } else if (typeof backendDetail === 'string' && backendDetail !== "") {
        // If it starts with the prefix we added in security.py, clean it up
        errorMessage = backendDetail.replace("Error creating user in Firebase: ", "");
        errorMessage = errorMessage.replace("Error creating user: ", "");
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add New User
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>
            Create a new {isSeniorAdmin ? "driver or administrator" : "driver"} account.
            {!isSeniorAdmin && " (Only senior admin heads can create accounts)"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* User Type Selection */}
            <div className="space-y-2">
              <Label htmlFor="role">User Type *</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => handleInputChange("role", value)}
                disabled={!isSeniorAdmin}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4" />
                      <span>Driver</span>
                    </div>
                  </SelectItem>
                  {isSeniorAdmin && (
                    <SelectItem value="administrator">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        <span>Administrator</span>
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Basic Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={formData.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1234567890"
                  value={formData.phone_number}
                  onChange={(e) => handleInputChange("phone_number", e.target.value)}
                />
              </div>
            </div>

            {/* Driver-Specific Fields */}
            {formData.role === "driver" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vehicle_type">Vehicle Type *</Label>
                  <Select
                    value={formData.vehicle_type}
                    onValueChange={(value) => handleInputChange("vehicle_type", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bike">Bike</SelectItem>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="van">Van</SelectItem>
                      <SelectItem value="truck">Truck</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="license_plate">License Plate *</Label>
                  <Input
                    id="license_plate"
                    placeholder="ABC-1234"
                    value={formData.license_plate}
                    onChange={(e) => handleInputChange("license_plate", e.target.value)}
                    required={formData.role === "driver"}
                  />
                </div>
              </div>
            )}

            {/* Administrator-Specific Fields */}
            {formData.role === "administrator" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      placeholder="Operations"
                      value={formData.department}
                      onChange={(e) => handleInputChange("department", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="access_level">Access Level *</Label>
                    <Select
                      value={formData.access_level.toString()}
                      onValueChange={(value) => handleInputChange("access_level", parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Level 1 - Admin</SelectItem>
                        <SelectItem value="2">Level 2 - Admin Head</SelectItem>
                        <SelectItem value="3">Level 3 - Senior Admin Head</SelectItem>
                        <SelectItem value="4">Level 4 - Director</SelectItem>
                        <SelectItem value="5">Level 5 - Executive</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="space-y-2">
                      <Label htmlFor="admin_role">Role</Label>
                      <Input
                        id="admin_role"
                        placeholder="Operations Manager"
                        value={formData.admin_role}
                        onChange={(e) => handleInputChange("admin_role", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
