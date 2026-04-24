# OptiRide

OptiRide is a comprehensive fleet management and driver safety monitoring system. It leverages AI-driven demand forecasting, real-time safety monitoring, and dynamic order allocation to optimize delivery operations and ensure driver well-being.

## 🏗️ System Architecture

The project consists of three main components:
1.  **Backend (FastAPI)**: The central API handling logic, database interactions and machine learning services (demand forecasting, zone clustering).
2.  **Admin Dashboard (Vite/React)**: A web-based interface for fleet managers to monitor drivers, view analytics, manage orders, and respond to safety alerts.
3.  **Mobile App (Expo/React Native)**: A mobile application for drivers to receive orders, track their status, monitor their safety scores, and trigger emergency protocols.

---

## Links

1.  **Informational Website**: [info.optiride.app](https://info.optiride.app)
2.  **Admin Dashboard**: [admin.optiride.app](https://admin.optiride.app)
3.  **Driver Mobile App**: [![Android Download](https://img.shields.io/badge/Download-APK-green?logo=android&style=for-the-badge)](https://github.com/sadreammm/optiride/releases/latest)
4.  **YouTube**: [Demo Video](https://youtu.be/iRk6zZUTvhk)
5.  **Presentation**: [Solution Presentation](https://optiride.my.canva.site/)
   
---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18+)
- [Python](https://www.python.org/) (v3.12+)
- [Docker & Docker Compose](https://www.docker.com/) (for infrastructure)
- [Expo Go](https://expo.dev/client) (on your mobile device for testing the driver app)

---

## 🌐 Live Access

If you prefer to use the system directly without a local setup, you can access the live versions here:

- **🌍 Informational Website**: [info.optiride.app](https://info.optiride.app)
- **💻 Admin Dashboard**: [admin.optiride.app](https://admin.optiride.app)
- **📱 Driver Mobile App**: [![Android Download](https://img.shields.io/badge/Download-APK-green?logo=android&style=for-the-badge)](https://github.com/sadreammm/optiride/releases/latest)

Test Credentials:
- **Admin User**:
     - Username: test_admin@optiride.com
     - Password: Optiride_test_admin1
- **Driver User**:
     - Username: test_driver@optiride.com
     - Password: Optiride_test_driver1

### 📥 How to Install the Mobile App
1. Download the `OptiRide.apk` from the link above.
2. Open the file on your Android device.
3. Allow "Install from Unknown Sources" if prompted.
---

## 🚀 Getting Started

You can run Optiride using two methods: **Docker (Quick Start)** or **Manual (Development Setup)**.

### Method 1: Docker (Quick Start)
Best for demonstration. Starts all services, including infrastructure and application components.

1.  **Firebase Credentials**: Place your `serviceAccount.json` in the `Backend/` directory (see [Firebase Setup](#-firebase-setup) below).
2.  **Environment Setup**: Create a `.env` file in the **root directory** with the following keys:
    ```bash
    # --- API Keys ---
    GOOGLE_MAPS_API_KEY=your_google_maps_key
    GEMINI_API_KEY=your_gemini_key
    
    # --- Database ---
    POSTGRES_USER=postgres
    POSTGRES_PASSWORD=your_password
    POSTGRES_DB=optiride
    
    # --- Admin Dashboard ---
    VITE_API_BASE_URL=http://localhost:8000
    VITE_WS_URL=ws://localhost:8000/ws
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
    ```
3.  **Run with Docker**:
    ```bash
    docker-compose up -d --build
    ```
3.  **Access**:
    - **Backend API**: `http://localhost:8000`
    - **Admin Dashboard**: `http://localhost:5173`

> [!NOTE]
> The Mobile App must still be run manually via Expo (see [Step 4](#4-mobile-app-setup-always-local)).

---

### Method 2: Manual (Development Setup)
Best for active development with hot-reloading.

#### 1. Start Infrastructure
```bash
docker-compose up -d db redis zookeeper kafka
```

#### 2. Backend Setup
1.  **Navigate & Env**:
    ```bash
    cd Backend
    # Create .env (see configuration section)
    ```
2.  **Virtual Environment**:
    ```bash
    python -m venv .venv
    .venv\Scripts\activate # For macOS: source .venv/bin/activate
    pip install -r requirements.txt
    ```
3.  **Launch Backend**: `python main.py`
    *(DB tables are created automatically on startup)*.

4.  **Create Initial Admin (SQL)**:
    Once you have a Firebase UID (see [Firebase Setup](#🔥-firebase-setup)), run the following SQL command to link your account to the database:
    ```bash
    psql -h localhost -U postgres -d optiride -c "INSERT INTO users (user_id, email, name, user_type) VALUES ('YOUR_UID', 'admin@test.com', 'Admin', 'administrator'); INSERT INTO administrators (admin_id, user_id, role, department, access_level) VALUES ('ADM-INITIAL', 'YOUR_UID', 'admin_head', 'Operations', 5);"
    ```

#### 3. Admin Dashboard Setup
1.  **Navigate & Install**:
    ```bash
    cd AdminDashboard
    npm install
    ```
2.  **Run**: `npm run dev`

---

### 4. User Management (CLI)
You can create more users directly from your terminal using `psql`:

**Create an Administrator:**
```bash
psql -h localhost -U postgres -d optiride -c "INSERT INTO users (user_id, email, name, user_type) VALUES ('UID', 'email@test.com', 'Name', 'administrator'); INSERT INTO administrators (admin_id, user_id, role, department, access_level) VALUES ('ADM-ID', 'UID', 'fleet_manager', 'Operations', 1);"
```

**Create a Driver:**
```bash
psql -h localhost -U postgres -d optiride -c "INSERT INTO users (user_id, email, name, user_type) VALUES ('UID', 'email@test.com', 'Name', 'driver'); INSERT INTO drivers (driver_id, user_id, name, vehicle_type, status) VALUES ('GENERATE_UUID', 'UID', 'Name', 'motorcycle', 'offline');"
```
Or you can use the Admin Dashboard to create users by navigating to settings > Admins' Settings > + Add New User

---

### 5. Mobile App Setup
1.  **Navigate & Install**:
    ```bash
    cd frontend_app
    npm install
    ```
2.  **Start Expo**: `npx expo start`
3.  **Connect**: Scan the QR code with **Expo Go** (Android) or the Camera app (iOS).

---

## 🔥 Firebase Setup

Optiride relies on Firebase for Authentication.

1.  **Create Project**: Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
2.  **Enable Authentication**: Go to **Build > Authentication** and enable **Email/Password**.
3.  **Backend (Admin SDK)**:
    - Go to **Project Settings > Service Accounts**.
    - Click **Generate new private key**.
    - Rename the downloaded file to `serviceAccount.json` and place it in the `Backend/` folder.
4.  **Frontend (Web SDK)**:
    - Go to **Project Overview** and click the **Web icon** (`</>`) to add a web app.
    - Copy the `firebaseConfig` object provided by Firebase.
    - **Step-by-step**: Use these values in your `AdminDashboard/.env` and `frontend_app/.env` (see the [Environment Configuration](#⚙️-environment-configuration) section below).
    - **Note**: The app reads these from the environment, but you can also find the initialization logic in `AdminDashboard/src/config/firebase.js` if you need to troubleshoot.

---

## 👤 Initial Admin Account

Since the database uses Firebase UIDs, you must manually sync your first admin account:

1.  **Create User**: Go to Firebase Console > Authentication > Users and click **Add user**.
2.  **Get UID**: Copy the `User UID` of the newly created account.
3.  **Sync to DB**: Run the SQL command shown in the Backend setup section.

---

## ⚙️ Environment Configuration

Each component requires its own `.env` file. Below are the required structures and descriptions.

### Backend (`Backend/.env`)
```bash
ENVIRONMENT=development
DATABASE_URL=postgresql://user:password@localhost:5432/optiride
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
REDIS_HOST=localhost
REDIS_PORT=6379
GOOGLE_MAPS_API_KEY=your_google_maps_key
GEMINI_API_KEY=your_gemini_key
FIREBASE_CREDENTIALS_PATH=serviceAccount.json
```

### Admin Dashboard (`AdminDashboard/.env`)
```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Firebase (Web SDK)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Mobile App (`frontend_app/.env`)
```bash
# For Android Emulator use: http://10.0.2.2:8000
# For Physical Device use your machine IP: http://YOUR_IP:8000
# For iOS Simulator use: http://localhost:8000
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Firebase
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=...
```

---

## 📖 User Guide

### 👮 Admin Dashboard
- **Fleet Dashboard**: View the live location of all drivers on the map.
- **Driver Monitoring**: View the status of all drivers.
- **Safety Alerts**: Receive instant notifications for driver fatigue, harsh braking, or SOS triggers.
- **Analytics**:
    - View **Demand Forecasting** to anticipate busy zones.
    - Check **Zone-Level Performance** and **Fleet Safety Statistics**.
- **User Management**: Create and manage roles for admins and drivers.

### 🚲 Driver Mobile App
- **Order Management**: Receive new order notifications, accept orders, and navigate to customer locations.
- **Safety Features**:
    - **Fatigue Monitoring**: Real-time feedback on fatigue levels (if integrated with sensors/camera).
    - **Safety Score**: Daily performance rating based on driving behavior.
    - **SOS Protocol**: Quick access button to trigger emergency alerts to the admin dashboard.
- **Fleet Communication**: Real-time status updates (Online/Offline/On-Break).

---

## 📄 License
This project is developed by TechCodeX as part of CSIT321.
