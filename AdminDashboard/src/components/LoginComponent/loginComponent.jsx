import { useState } from "react";
import { User, Lock, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import optirideLogo from "@/assets/optiride.png";

const LoginComponent = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const [forgotOpen, setForgotOpen] = useState(false);
    const [forgotEmail, setForgotEmail] = useState("");
    const [resetStep, setResetStep] = useState("email");
    const [verificationCode, setVerificationCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [resetError, setResetError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoginError("");
        setIsLoading(true);

        const result = await login(email, password);
        if (result.success) {
            if (result.role === 'administrator') {
                navigate('/admin/dashboard');
            } else {
                setLoginError("Invalid credentials");
            }
        } else {
            setLoginError(result.message);
        }
        setIsLoading(false);
    };

    const resetForgotState = () => {
        setForgotEmail("");
        setVerificationCode("");
        setNewPassword("");
        setConfirmPassword("");
        setResetError("");
        setResetStep("email");
    };

    const handleForgotOpenChange = (open) => {
        setForgotOpen(open);
        if (!open) resetForgotState();
    };

    const handleEmailSubmit = (e) => {
        e.preventDefault();
        if (!forgotEmail.trim()) {
            setResetError("Please enter your email.");
            return;
        }
        setResetError("");
        setResetStep("code");
    };

    const handleCodeSubmit = (e) => {
        e.preventDefault();
        if (!verificationCode.trim()) {
            setResetError("Enter the verification code.");
            return;
        }
        setResetError("");
        setResetStep("password");
    };

    const handlePasswordSubmit = (e) => {
        e.preventDefault();
        if (!newPassword || !confirmPassword) {
            setResetError("Enter and confirm your new password.");
            return;
        }
        if (newPassword !== confirmPassword) {
            setResetError("Passwords do not match.");
            return;
        }
        setResetError("");
        handleForgotOpenChange(false);
    };

    return (
        <div className="w-full max-w-lg">
            {/* Logo Card */}
            <div className="bg-card rounded-2xl shadow-2xl p-8 bg-white/90 backdrop-blur-sm">
                {/* Logo */}
                <div className="flex flex-col items-center mb-8">
                    <img
                        src={optirideLogo}
                        alt="OptiRide logo"
                        className="h-20 w-auto drop-shadow-xl"
                        loading="lazy"
                    />
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {loginError && (
                        <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
                            {loginError}
                        </div>
                    )}

                    <div className="relative">
                        <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                            type="email" 
                            placeholder="EMAIL ADDRESS"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-10 h-12 bg-secondary border-gray-200"
                            required
                        />
                    </div>

                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                            type="password"
                            placeholder="PASSWORD"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pl-10 h-12 bg-secondary border-gray-200"
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Logging in...
                            </>
                        ) : (
                            "LOGIN"
                        )}
                    </Button>
                </form>

                {/* Forgot Password Link */}
                <div className="text-center mt-4">
                    <button
                        type="button"
                        onClick={() => handleForgotOpenChange(true)}
                        className="text-sm text-primary hover:underline"
                    >
                        Forgot password?
                    </button>
                </div>
            </div>

            {/* Forgot Password Dialog */}
            <Dialog open={forgotOpen} onOpenChange={handleForgotOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reset your password</DialogTitle>
                        <DialogDescription>
                            {resetStep === "email" && "Enter your email to receive a code."}
                            {resetStep === "code" && `We sent a code to ${forgotEmail}.`}
                            {resetStep === "password" && "Set your new password."}
                        </DialogDescription>
                    </DialogHeader>

                    {resetStep === "email" && (
                        <form className="space-y-4" onSubmit={handleEmailSubmit}>
                            <Input
                                type="email"
                                required
                                placeholder="you@example.com"
                                value={forgotEmail}
                                onChange={(e) => setForgotEmail(e.target.value)}
                            />
                            {resetError && <p className="text-sm text-red-500">{resetError}</p>}
                            <DialogFooter>
                                <Button variant="outline" type="button" onClick={() => handleForgotOpenChange(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">Send code</Button>
                            </DialogFooter>
                        </form>
                    )}

                    {resetStep === "code" && (
                        <form className="space-y-4" onSubmit={handleCodeSubmit}>
                            <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="Enter verification code"
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value)}
                            />
                            {resetError && <p className="text-sm text-red-500">{resetError}</p>}
                            <DialogFooter>
                                <Button variant="outline" type="button" onClick={() => setResetStep("email")}>
                                    Back
                                </Button>
                                <Button type="submit">Verify code</Button>
                            </DialogFooter>
                        </form>
                    )}

                    {resetStep === "password" && (
                        <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                            <Input
                                type="password"
                                placeholder="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <Input
                                type="password"
                                placeholder="Confirm new password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            {resetError && <p className="text-sm text-red-500">{resetError}</p>}
                            <DialogFooter>
                                <Button variant="outline" type="button" onClick={() => setResetStep("code")}>
                                    Back
                                </Button>
                                <Button type="submit">Change password</Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default LoginComponent;