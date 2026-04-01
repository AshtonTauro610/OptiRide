import { createContext, useState, useContext, useEffect } from "react";
import { signInWithEmailAndPassword, signOut, onIdTokenChanged } from "firebase/auth";
import { auth } from "../config/firebase";
import { apiClient as api } from "../utils/api.config";

const AuthContext = createContext(null);
const SESSION_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const isSessionExpired = () => {
        const loginTime = localStorage.getItem('optiride_login_time');
        if (!loginTime) return true;
        return Date.now() - parseInt(loginTime) > SESSION_MAX_AGE_MS;
    };

    const clearSession = () => {
        localStorage.removeItem('optiride_token');
        localStorage.removeItem('optiride_user');
        localStorage.removeItem('optiride_login_time');
        setUser(null);
    };

    useEffect(() => {
        const storedUser = localStorage.getItem('optiride_user');
        if (storedUser && !isSessionExpired()) {
            setUser(JSON.parse(storedUser));
        } else if (storedUser) {
            // Session expired — clean up
            clearSession();
        }
        setLoading(false);

        // Auto-refresh: whenever Firebase refreshes the token, update localStorage
        const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
            if (firebaseUser && !isSessionExpired()) {
                const newToken = await firebaseUser.getIdToken();
                localStorage.setItem('optiride_token', newToken);
            } else if (isSessionExpired()) {
                clearSession();
                await signOut(auth);
            }
        });

        // Force-refresh token every 45 minutes (Firebase tokens expire at 60 min)
        const refreshInterval = setInterval(async () => {
            if (isSessionExpired()) {
                clearSession();
                await signOut(auth);
                return;
            }
            const currentUser = auth.currentUser;
            if (currentUser) {
                const newToken = await currentUser.getIdToken(true);
                localStorage.setItem('optiride_token', newToken);
            }
        }, 45 * 60 * 1000);

        return () => {
            unsubscribe();
            clearInterval(refreshInterval);
        };
    }, []);

    const login = async (email, password) => {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const firebaseUser = userCredential.user;

            const idToken = await firebaseUser.getIdToken();
            const response = await api.post('/auth/login', {
                credentials: idToken
            });

            const { token: tokenData, user: userData } = response.data;

            localStorage.setItem('optiride_token', tokenData.token);
            localStorage.setItem('optiride_user', JSON.stringify(userData));
            localStorage.setItem('optiride_login_time', Date.now().toString());
            setUser(userData);
            return { success: true, role: userData.user_type };

        } catch (error) {
            console.error("Login error:", error);
            let message = "An error occurred during login.";
            if (error.response) {
                message = error.response.data.detail || "Login failed.";
            } else if (error.code) {
                message = error.code;
            }
            return { success: false, message };
        }
    }
    const logout = async () => {
        await signOut(auth);
        clearSession();
    }
    return (
        <AuthContext.Provider value={{ user, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
}

