import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, HTTPException, status
from typing import Optional
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.database import get_db
from app.models.user import User

# Only initialize Firebase if credentials file exists
if os.path.exists(settings.FIREBASE_CREDENTIALS_PATH) and not firebase_admin._apps:
    try:
        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"Warning: Firebase initialization failed: {e}")
        print("Firebase authentication will be disabled for development")

security_scheme = HTTPBearer()

def verify_firebase_token(creds : HTTPAuthorizationCredentials = Depends(security_scheme)):
    token = creds.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except auth.InvalidIdTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase token",
        )
    except auth.ExpiredIdTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expired Firebase token",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )


def verify_firebase_token_string(token: str) -> dict:
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase token",
        )
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expired Firebase token",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )


get_firebase_user = verify_firebase_token

def create_firebase_user(email: str, password: str, phone_number: Optional[str] = None):
    try:
        user = {
            "email": email,
            "password": password
        }
        if phone_number:
            user["phone_number"] = phone_number
        
        firebase_user = auth.create_user(**user)
        return firebase_user.uid    
    
    except auth.EmailAlreadyExistsError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists",
        )
    except auth.PhoneNumberAlreadyExistsError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already exists",
        )
    except Exception as e:
        error_msg = str(e)
        if "INVALID_PHONE_NUMBER" in error_msg:
            if "TOO_SHORT" in error_msg:
                error_msg = "Phone number is too short"
            else:
                error_msg = "Invalid phone number format"
        elif "EMAIL_EXISTS" in error_msg:
            error_msg = "Email already exists"
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg,
        )

def delete_firebase_user(uid: str):
    try:
        auth.delete_user(uid)
    except auth.UserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in Firebase",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error deleting user from Firebase",
        )

def update_firebase_user(uid: str, email: Optional[str] = None, password: Optional[str] = None, phone_number: Optional[str] = None):
    try:
        # Collect all updates and make a single call to avoid partial failures
        updates = {}
        if email:
            updates["email"] = email
        if password:
            updates["password"] = password
        if phone_number:
            updates["phone_number"] = phone_number
        
        if updates:
            auth.update_user(uid, **updates)
    except auth.UserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in Firebase",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error updating user in Firebase",
        )

def send_password_reset_email(email: str):
    try:
        link = auth.generate_password_reset_link(email)
        return link
    except auth.UserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in Firebase",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error generating password reset link",
        )

